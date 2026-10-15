import { encodeAbiParameters, getAddress, keccak256, type Address, type Hash } from 'viem';
import {
  ChainPolicyError,
  prepareAction,
  sameMandate,
  type BoundraChainReader,
  type ExecutorSnapshot,
} from '@boundra/chain';
import { enqueueJob, Prisma, type PrismaClient, type SqlClient } from '@boundra/database';
import { mandateTupleFromRow } from '@boundra/shared';
import type { OperatorExecutionService, ExecutionStore } from '../chain/execution';
import type { RiskEventMonitor } from '../chain/monitor';
import {
  candidatesOf,
  decide,
  mandateStatus,
  POLICY_VERSION,
  type Decision,
  type MandateLimits,
} from './decision';
import type { WorkerMode } from '../runtime/activation';

export const JOB = {
  VERIFY_AUTHORIZATION: 'VERIFY_AUTHORIZATION',
  EVALUATE_MANDATE: 'EVALUATE_MANDATE',
  EXECUTE_ACTION: 'EXECUTE_ACTION',
  RECONCILE_ACTION: 'RECONCILE_ACTION',
  EVALUATE_RISK: 'EVALUATE_RISK',
  MONITOR_POLL: 'MONITOR_POLL',
} as const;

const ACTIVE_STATES = ['ACTION_PROPOSED', 'POLICY_CHECKED', 'BROADCAST', 'RECONCILE'] as const;
const nowSeconds = () => BigInt(Math.floor(Date.now() / 1000));
const exact = (value: { toFixed(d: number): string }) => BigInt(value.toFixed(0));
type TransactionDecision = Extract<Decision, { kind: 'DEPOSIT' | 'WITHDRAW' }>;
const isTransaction = (decision: Decision): decision is TransactionDecision =>
  decision.kind === 'DEPOSIT' || decision.kind === 'WITHDRAW';
const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

export interface OrchestratorDeps {
  db: PrismaClient;
  reader: BoundraChainReader;
  mode: WorkerMode;
  actionDeadlineSeconds: number;
  /** Present only in execute mode. */
  execution?: { service: OperatorExecutionService; store: ExecutionStore; operator: Address };
  monitor?: RiskEventMonitor;
}

type MandateWithParties = Prisma.MandateGetPayload<{ include: { executor: true; owner: true } }>;

/**
 * Workflow on top of the chain ports. Every handler is idempotent and safe to run on several
 * workers at once: chain state is re-read, and database uniqueness decides races.
 */
export class Orchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  private get db() {
    return this.deps.db;
  }

  private limitsOf(m: MandateWithParties): MandateLimits {
    return {
      selectedVault: m.selectedVault === 'TIMED' ? 'TIMED' : 'LIQUID',
      onchainVersion: m.onchainVersion ? exact(m.onchainVersion) : 0n,
      expiresAt: exact(m.expiresAt),
      allowedActions: m.allowedActions,
      maxDepositPerAction: exact(m.maxDepositPerAction),
      maxCumulativeDeposits: exact(m.maxCumulativeDeposits),
      maxWithdrawPerAction: exact(m.maxWithdrawPerAction),
      allocationTarget: exact(m.allocationTarget),
      escalated: m.escalatedAt !== null,
    };
  }

  private loadMandate(id: string) {
    return this.db.mandate.findUnique({ where: { id }, include: { executor: true, owner: true } });
  }

  /**
   * FR-05: AUTHORIZED only once the confirmed on-chain mandate equals the approved tuple field by
   * field and its version was never credited to another approval.
   */
  async verifyAuthorization(mandateId: string): Promise<string> {
    const m = await this.loadMandate(mandateId);
    if (!m || m.status !== 'APPROVED' || !m.executor) return 'SKIPPED';
    if (exact(m.expiresAt) <= nowSeconds()) {
      await this.db.$transaction([
        this.db.mandate.update({ where: { id: m.id }, data: { status: 'EXPIRED' } }),
        this.activity(this.db, m, 'MANDATE_EXPIRED', {
          reason: 'Expired before on-chain authorization',
        }),
      ]);
      return 'EXPIRED';
    }
    const s = await this.deps.reader.snapshot(
      getAddress(m.owner.address),
      getAddress(m.executor.address),
    );
    if (s.mandateVersion === 0n || s.revoked || !sameMandate(s.mandate, mandateTupleFromRow(m)))
      return 'PENDING';
    const version = s.mandateVersion.toString();
    const claimed = await this.db.mandate.findFirst({
      where: { executorId: m.executor.id, onchainVersion: version, id: { not: m.id } },
    });
    if (claimed) return 'PENDING';
    const funded = s.idleBalance >= this.plannedDeposit(this.limitsOf(m));
    try {
      await this.db.$transaction(async (tx) => {
        await tx.mandate.updateMany({
          where: { executorId: m.executor!.id, status: 'AUTHORIZED', id: { not: m.id } },
          data: { status: 'SUPERSEDED' },
        });
        const updated = await tx.mandate.updateMany({
          where: { id: m.id, status: 'APPROVED' },
          data: {
            status: 'AUTHORIZED',
            onchainVersion: version,
            authorizedBlock: s.blockNumber.toString(),
            authorizedAt: new Date(),
            ...(funded ? { fundedAtBlock: s.blockNumber.toString() } : {}),
          },
        });
        if (updated.count !== 1) return;
        await tx.intent.update({ where: { id: m.intentId }, data: { state: 'AUTHORIZED' } });
        await this.activity(tx, m, 'MANDATE_AUTHORIZED', {
          onchainVersion: version,
          mandateHash: m.mandateHash,
          block: s.blockNumber.toString(),
          blockHash: s.blockHash,
          funded,
        });
        await enqueueJob(tx, {
          key: `evaluate:${m.id}:authorized`,
          kind: JOB.EVALUATE_MANDATE,
          payload: { mandateId: m.id, trigger: 'authorized' },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) return 'PENDING';
      throw error;
    }
    return 'AUTHORIZED';
  }

  private plannedDeposit(limits: MandateLimits) {
    return limits.allocationTarget < limits.maxDepositPerAction
      ? limits.allocationTarget
      : limits.maxDepositPerAction;
  }

  /** One evaluation of an authorized mandate: lifecycle, decision, and at most one proposal. */
  async evaluateMandate(mandateId: string, trigger: string): Promise<string> {
    const m = await this.loadMandate(mandateId);
    if (!m || m.status !== 'AUTHORIZED' || !m.executor) return 'SKIPPED';
    const active = await this.db.actionProposal.findFirst({
      where: { executor: m.executor.address, state: { in: [...ACTIVE_STATES] } },
    });
    if (active) {
      if (this.deps.mode === 'execute') await this.enqueueReconcile(this.db, active.actionId);
      return 'BUSY';
    }
    const s = await this.deps.reader.snapshot(
      getAddress(m.owner.address),
      getAddress(m.executor.address),
    );
    const limits = this.limitsOf(m);
    const now = nowSeconds();
    const status = mandateStatus(s, limits, now);
    if (status) {
      await this.db.$transaction(async (tx) => {
        const updated = await tx.mandate.updateMany({
          where: { id: m.id, status: 'AUTHORIZED' },
          data: { status: status.status },
        });
        if (updated.count === 1)
          await this.activity(tx, m, `MANDATE_${status.status}`, {
            reasonCode: status.reasonCode,
            reason: status.reason,
            block: s.blockNumber.toString(),
          });
      });
      return status.status;
    }
    if (!m.fundedAtBlock && s.idleBalance >= this.plannedDeposit(limits)) {
      await this.db.$transaction([
        this.db.mandate.update({
          where: { id: m.id },
          data: { fundedAtBlock: s.blockNumber.toString() },
        }),
        this.activity(this.db, m, 'EXECUTOR_FUNDED', {
          idle: s.idleBalance.toString(),
          block: s.blockNumber.toString(),
        }),
      ]);
    }
    const decision = decide(s, limits, now);
    if (!isTransaction(decision)) {
      await this.recordPassiveDecision(m, decision, s, trigger);
      return decision.kind;
    }
    return this.propose(m, decision, s, trigger);
  }

  private async recordPassiveDecision(
    m: MandateWithParties,
    decision: Extract<Decision, { kind: 'HOLD' | 'ESCALATE' }>,
    s: ExecutorSnapshot,
    trigger: string,
  ) {
    const last = await this.db.decision.findFirst({
      where: { mandateId: m.id },
      orderBy: { createdAt: 'desc' },
    });
    // A repeated HOLD/ESCALATE adds no information; only changes are logged.
    if (last && last.kind === decision.kind && last.reasonCode === decision.reasonCode) return;
    await this.db.$transaction(async (tx) => {
      await tx.decision.create({ data: this.decisionData(m, decision, s, trigger) });
      if (decision.kind === 'ESCALATE' && !m.escalatedAt)
        await tx.mandate.update({
          where: { id: m.id },
          data: { escalatedAt: new Date(), escalationReason: decision.reasonCode },
        });
      await this.activity(tx, m, `DECISION_${decision.kind}`, {
        reasonCode: decision.reasonCode,
        reason: decision.reason,
        trigger,
        block: s.blockNumber.toString(),
      });
    });
  }

  private decisionData(
    m: MandateWithParties,
    decision: Decision,
    s: ExecutorSnapshot,
    trigger: string,
  ) {
    return {
      mandateId: m.id,
      kind: decision.kind,
      trigger: trigger.slice(0, 64),
      reasonCode: decision.reasonCode,
      reasonSummary: decision.reason,
      candidates: candidatesOf(s),
      snapshotBlock: s.blockNumber.toString(),
      snapshotBlockHash: s.blockHash.toLowerCase(),
      policyVersion: POLICY_VERSION,
    };
  }

  private async propose(
    m: MandateWithParties,
    decision: Extract<Decision, { kind: 'DEPOSIT' | 'WITHDRAW' }>,
    s: ExecutorSnapshot,
    trigger: string,
  ): Promise<string> {
    const executor = m.executor!.address;
    if (this.deps.mode !== 'execute') {
      // Monitor-only workers record what they would do but never queue a transaction.
      await this.recordPassiveDecision(
        m,
        {
          kind: 'HOLD',
          reasonCode: `EXECUTION_DISABLED_${decision.kind}`,
          reason: `Execution is disabled; a ${decision.kind.toLowerCase()} would be proposed.`,
        },
        s,
        trigger,
      );
      return 'EXECUTION_DISABLED';
    }
    const proposalSeq = await this.db.actionProposal.count({
      where: { executor, contractNonce: s.nextActionNonce.toString() },
    });
    // Deterministic ID: concurrent workers proposing the same step collide on uniqueness.
    const actionId = keccak256(
      encodeAbiParameters(
        [
          { type: 'uint256' },
          { type: 'address' },
          { type: 'uint256' },
          { type: 'uint256' },
          { type: 'uint256' },
        ],
        [84532n, getAddress(executor), s.mandateVersion, s.nextActionNonce, BigInt(proposalSeq)],
      ),
    ).toLowerCase() as Hash;
    const now = nowSeconds();
    const expiry = exact(m.expiresAt);
    const desired = now + BigInt(this.deps.actionDeadlineSeconds);
    const deadline = desired < expiry ? desired : expiry;
    const envelope = {
      actionId,
      kind: decision.kind,
      mandateVersion: s.mandateVersion.toString(),
      nonce: s.nextActionNonce.toString(),
      deadline: deadline.toString(),
      target: getAddress(decision.target),
      amount: decision.amount.toString(),
    };
    let codes: string[] = [];
    try {
      prepareAction(s, envelope, this.deps.execution!.operator);
    } catch (error) {
      if (!(error instanceof ChainPolicyError)) throw error;
      codes = [error.code];
    }
    const passed = codes.length === 0;
    try {
      await this.db.$transaction(async (tx) => {
        const row = await tx.decision.create({ data: this.decisionData(m, decision, s, trigger) });
        await tx.actionProposal.create({
          data: {
            actionId,
            decisionId: row.id,
            mandateId: m.id,
            executor,
            onchainVersion: s.mandateVersion.toString(),
            contractNonce: s.nextActionNonce.toString(),
            proposalSeq,
            kind: decision.kind,
            target: decision.target.toLowerCase(),
            amount: decision.amount.toString(),
            deadline: deadline.toString(),
            envelope,
            state: passed ? 'POLICY_CHECKED' : 'REJECTED',
            rejectionCode: passed ? null : codes[0]!,
          },
        });
        await tx.policyCheck.create({
          data: {
            actionId,
            verifierVersion: POLICY_VERSION,
            passed,
            codes,
            results: { stage: 'proposal', snapshotBlock: s.blockNumber.toString() },
          },
        });
        await this.activity(
          tx,
          m,
          passed ? 'ACTION_PROPOSED' : 'ACTION_REJECTED',
          {
            kind: decision.kind,
            amount: decision.amount.toString(),
            target: decision.target.toLowerCase(),
            reasonCode: passed ? decision.reasonCode : codes[0],
            reason: decision.reason,
            trigger,
          },
          actionId,
        );
        if (passed)
          await enqueueJob(tx, {
            key: `execute:${actionId}`,
            kind: JOB.EXECUTE_ACTION,
            payload: { actionId },
          });
      });
    } catch (error) {
      if (isUniqueViolation(error)) return 'DUPLICATE';
      throw error;
    }
    return passed ? 'PROPOSED' : 'REJECTED';
  }

  /** Dispatches or reconciles one action through the operator execution service. */
  async executeAction(actionId: string, finalAttempt: boolean): Promise<string> {
    const p = await this.db.actionProposal.findUnique({
      where: { actionId },
      include: { mandate: { include: { executor: true, owner: true } } },
    });
    if (!p || !(ACTIVE_STATES as readonly string[]).includes(p.state)) return 'SKIPPED';
    const execution = this.deps.execution;
    if (!execution) return 'EXECUTION_DISABLED';
    const m = p.mandate;
    const owner = getAddress(m.owner.address);
    const executor = getAddress(p.executor);
    let state: string;
    try {
      state = await execution.service.execute(owner, executor, p.envelope);
    } catch (error) {
      const attempt = await execution.store.findAttempt(actionId as Hash);
      if (error instanceof ChainPolicyError && !attempt) {
        // Nothing was signed: the action is rejected with the guard's reason.
        await this.db.$transaction(async (tx) => {
          await tx.actionProposal.update({
            where: { actionId },
            data: { state: 'REJECTED', rejectionCode: error.code },
          });
          await tx.policyCheck.create({
            data: {
              actionId,
              verifierVersion: POLICY_VERSION,
              passed: false,
              codes: [error.code],
              results: { stage: 'dispatch' },
            },
          });
          await this.activity(
            tx,
            m,
            'ACTION_REJECTED',
            { reasonCode: error.code, stage: 'dispatch' },
            actionId,
          );
        });
        return 'REJECTED';
      }
      if (finalAttempt && !attempt) {
        await this.db.$transaction([
          this.db.actionProposal.update({
            where: { actionId },
            data: { state: 'FAILED', rejectionCode: 'DISPATCH_FAILED' },
          }),
          this.activity(this.db, m, 'ACTION_FAILED', { reasonCode: 'DISPATCH_FAILED' }, actionId),
        ]);
        return 'FAILED';
      }
      // A signed attempt exists: keep reconciling; never invent a replacement action.
      throw error;
    }
    const attempt = await execution.store.findAttempt(actionId as Hash);
    const txHash = attempt?.transactionHash.toLowerCase() ?? null;
    const workflow =
      state === 'CONFIRMED'
        ? 'CONFIRMED'
        : state === 'REVERTED'
          ? 'FAILED'
          : state === 'RECONCILE'
            ? 'RECONCILE'
            : 'BROADCAST';
    await this.db.$transaction(async (tx) => {
      const changed = await tx.actionProposal.updateMany({
        where: { actionId, state: { not: workflow } },
        data: { state: workflow, ...(workflow === 'FAILED' ? { rejectionCode: 'REVERTED' } : {}) },
      });
      if (changed.count === 1)
        await this.activity(
          tx,
          m,
          `ACTION_${workflow}`,
          { kind: p.kind, amount: p.amount.toFixed(0) },
          actionId,
          txHash,
        );
      if (workflow === 'BROADCAST' || workflow === 'RECONCILE')
        await this.enqueueReconcile(tx, actionId);
      if (workflow === 'CONFIRMED' || workflow === 'FAILED')
        await enqueueJob(tx, {
          key: `evaluate:${m.id}:after:${actionId}`,
          kind: JOB.EVALUATE_MANDATE,
          payload: { mandateId: m.id, trigger: `after:${p.kind.toLowerCase()}` },
        });
    });
    return workflow;
  }

  private enqueueReconcile(db: SqlClient, actionId: string) {
    const at = Date.now() + 5_000;
    return enqueueJob(db, {
      key: `reconcile:${actionId}:${Math.floor(at / 5_000)}`,
      kind: JOB.RECONCILE_ACTION,
      payload: { actionId },
      availableAt: new Date(at),
    });
  }

  /** A canonical risk event re-evaluates every authorized mandate exposed to that vault. */
  async fanOutRisk(riskEventId: string): Promise<number> {
    const event = await this.db.riskEvent.findUnique({ where: { id: riskEventId } });
    if (!event || event.status !== 'CANONICAL') return 0;
    const manifest = this.deps.reader.manifest;
    const vaultKey =
      event.source === manifest.liquidVault.toLowerCase()
        ? 'LIQUID'
        : event.source === manifest.timedVault.toLowerCase()
          ? 'TIMED'
          : null;
    if (!vaultKey) return 0;
    const mandates = await this.db.mandate.findMany({
      where: { status: 'AUTHORIZED', selectedVault: vaultKey },
      include: { executor: true, owner: true },
    });
    for (const m of mandates)
      await this.db.$transaction(async (tx) => {
        await this.activity(
          tx,
          m,
          'RISK_EVENT_OBSERVED',
          {
            vault: vaultKey,
            riskLevel: event.eventRiskLevel === 1 ? 'DEGRADED' : 'NORMAL',
            capacity: event.eventCapacity.toFixed(0),
            currentRiskLevel: event.currentRiskLevel === 1 ? 'DEGRADED' : 'NORMAL',
            block: event.blockNumber.toFixed(0),
            note: 'A risk warning is a signal to re-evaluate, not proof of loss.',
          },
          null,
          event.txHash,
        );
        await enqueueJob(tx, {
          key: `evaluate:${m.id}:risk:${event.id}:${event.blockHash}`,
          kind: JOB.EVALUATE_MANDATE,
          payload: { mandateId: m.id, trigger: 'risk' },
        });
      });
    return mandates.length;
  }

  async monitorPoll() {
    return this.deps.monitor ? this.deps.monitor.poll() : 'DISABLED';
  }

  /** Periodic ticks; bucketed keys keep enqueueing idempotent across workers. */
  async schedule(pollMs: number) {
    const bucket = Math.floor(Date.now() / pollMs);
    const slow = Math.floor(Date.now() / Math.max(pollMs * 3, 30_000));
    await enqueueJob(this.db, {
      key: `monitor:${bucket}`,
      kind: JOB.MONITOR_POLL,
      payload: {},
      maxAttempts: 1,
    });
    const authorized = await this.db.mandate.findMany({
      where: { status: 'AUTHORIZED' },
      select: { id: true },
    });
    for (const { id } of authorized)
      await enqueueJob(this.db, {
        key: `evaluate:${id}:tick:${bucket}`,
        kind: JOB.EVALUATE_MANDATE,
        payload: { mandateId: id, trigger: 'tick' },
        maxAttempts: 1,
      });
    const approved = await this.db.mandate.findMany({
      where: { status: 'APPROVED' },
      select: { id: true },
    });
    for (const { id } of approved)
      await enqueueJob(this.db, {
        key: `verify-authorization:${id}:tick:${slow}`,
        kind: JOB.VERIFY_AUTHORIZATION,
        payload: { mandateId: id },
        maxAttempts: 1,
      });
    if (this.deps.mode === 'execute') {
      const open = await this.db.actionProposal.findMany({
        where: { state: { in: [...ACTIVE_STATES] } },
        select: { actionId: true },
      });
      for (const { actionId } of open) await this.enqueueReconcile(this.db, actionId);
    }
  }

  private activity(
    db: SqlClient,
    m: { id: string; intentId: string; ownerId: string },
    type: string,
    payload: Prisma.InputJsonValue,
    actionId: string | null = null,
    txHash: string | null = null,
  ) {
    return db.activityEvent.create({
      data: {
        ownerId: m.ownerId,
        intentId: m.intentId,
        mandateId: m.id,
        type,
        payload,
        actionId,
        txHash,
      },
    });
  }
}
