import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import {
  createDatabaseClient,
  enqueueJob,
  JobQueue,
  LeaseManager,
  type PrismaClient,
} from '@boundra/database';
import { hashMandate } from '@boundra/chain';
import { mandateTupleFromRow } from '@boundra/shared';
import type { Hex } from 'viem';
import { OperatorExecutionService } from '../src/chain/execution';
import { AttemptCipher } from '../src/persistence/cipher';
import { PostgresExecutionStore } from '../src/persistence/execution-store';
import { JOB, Orchestrator } from '../src/orchestration/orchestrator';
import { handlersFor, JobRunner } from '../src/orchestration/job-runner';
import type { WorkerMode } from '../src/runtime/activation';
import { fakeChain, randomAddress } from './helpers/fake-chain';

let db: PrismaClient;
let leases: LeaseManager;
const cipher = new AttemptCipher(randomBytes(32).toString('hex'));
const owners: string[] = [];
const leaseKeys: string[] = [];

before(async () => {
  db = createDatabaseClient(process.env.DATABASE_URL!);
  await db.$connect();
  leases = new LeaseManager(db, { ttlMs: 2_000, waitMs: 10_000 });
});

after(async () => {
  const mandates = await db.mandate.findMany({ where: { ownerId: { in: owners } } });
  const mandateIds = mandates.map((m) => m.id);
  const actions = await db.actionProposal.findMany({ where: { mandateId: { in: mandateIds } } });
  const actionIds = actions.map((a) => a.actionId);
  for (const id of [...mandateIds, ...actionIds])
    await db.job.deleteMany({ where: { key: { contains: id } } });
  await db.attemptEvent.deleteMany({ where: { actionId: { in: actionIds } } });
  await db.transactionAttempt.deleteMany({ where: { actionId: { in: actionIds } } });
  await db.eoaNonceReservation.deleteMany({ where: { actionId: { in: actionIds } } });
  await db.policyCheck.deleteMany({ where: { actionId: { in: actionIds } } });
  await db.actionProposal.deleteMany({ where: { actionId: { in: actionIds } } });
  await db.decision.deleteMany({ where: { mandateId: { in: mandateIds } } });
  await db.activityEvent.deleteMany({ where: { ownerId: { in: owners } } });
  await db.mandate.deleteMany({ where: { ownerId: { in: owners } } });
  await db.executor.deleteMany({ where: { ownerId: { in: owners } } });
  await db.intent.deleteMany({ where: { ownerId: { in: owners } } });
  await db.walletIdentity.deleteMany({ where: { id: { in: owners } } });
  await db.riskEvent.deleteMany({ where: { txHash: { startsWith: '0xfeed' } } });
  await db.lease.deleteMany({ where: { key: { in: leaseKeys } } });
  await db.$disconnect();
});

/** One owner with an approved LiquidVault mandate for 300 MockUSDC, plus its chain fake. */
async function world(mode: WorkerMode = 'execute') {
  const chain = fakeChain();
  leaseKeys.push(`signer:84532:${chain.account.address.toLowerCase()}`);
  const ownerAddress = randomAddress();
  const executorAddress = randomAddress();
  const owner = await db.walletIdentity.create({ data: { address: ownerAddress.toLowerCase() } });
  owners.push(owner.id);
  const intent = await db.intent.create({
    data: {
      ownerId: owner.id,
      objective: 'Orchestrator fixture',
      amount: '300000000',
      state: 'MANDATE_PENDING',
    },
  });
  const executor = await db.executor.create({
    data: {
      ownerId: owner.id,
      address: executorAddress.toLowerCase(),
      factory: chain.manifest.factory.toLowerCase(),
      verifiedAtBlock: '100',
    },
  });
  const tupleFields = {
    asset: chain.token.toLowerCase(),
    operator: chain.account.address.toLowerCase(),
    beneficiary: ownerAddress.toLowerCase(),
    expiresAt: (chain.now + 604800n).toString(),
    allowedVaults: 1,
    allowedActions: 3,
    maxLockupSeconds: 0n,
    maxDepositPerAction: '300000000',
    maxCumulativeDeposits: '300000000',
    maxWithdrawPerAction: '300000000',
    allocationTarget: '300000000',
  };
  const draft = await db.mandate.create({
    data: {
      intentId: intent.id,
      ownerId: owner.id,
      executorId: executor.id,
      revision: 1,
      status: 'APPROVED',
      approvedAt: new Date(),
      selectedVault: 'LIQUID',
      ...tupleFields,
    },
  });
  await db.mandate.update({
    where: { id: draft.id },
    data: { mandateHash: hashMandate(mandateTupleFromRow(draft)) },
  });
  const snapshot = chain.snapshotOf(ownerAddress, executorAddress);
  // Before the owner's setMandate transaction there is no mandate on the executor.
  snapshot.mandateVersion = 0n;
  const make = (workerMode: WorkerMode = mode) => {
    const store = new PostgresExecutionStore(db, leases, cipher);
    return new Orchestrator({
      db,
      reader: chain.reader,
      mode: workerMode,
      actionDeadlineSeconds: 300,
      execution:
        workerMode === 'execute'
          ? {
              service: new OperatorExecutionService(chain.reader, chain.account, store, {
                maxGas: 500000n,
                maxFeePerGas: 10n,
                maxPriorityFeePerGas: 2n,
              }),
              store,
              operator: chain.account.address,
            }
          : undefined,
    });
  };
  const proposals = () =>
    db.actionProposal.findMany({ where: { mandateId: draft.id }, orderBy: { createdAt: 'asc' } });
  const mandate = () => db.mandate.findUniqueOrThrow({ where: { id: draft.id } });
  const activity = async () =>
    (await db.activityEvent.findMany({ where: { ownerId: owner.id }, orderBy: { id: 'asc' } })).map(
      (a) => a.type,
    );
  /** The owner's setMandate confirmed on-chain with exactly the approved tuple. */
  const authorizeOnChain = () => {
    snapshot.mandateVersion = 1n;
  };
  return {
    chain,
    snapshot,
    orchestrator: make(),
    make,
    draft,
    intent,
    owner,
    proposals,
    mandate,
    activity,
    authorizeOnChain,
  };
}

describe('authorization verification (FR-05)', () => {
  test('stays pending until the confirmed on-chain mandate equals the approved tuple', async () => {
    const w = await world();
    assert.equal(await w.orchestrator.verifyAuthorization(w.draft.id), 'PENDING');
    w.authorizeOnChain();
    w.snapshot.mandate = { ...w.snapshot.mandate, expiresAt: w.snapshot.mandate.expiresAt + 1n };
    assert.equal(
      await w.orchestrator.verifyAuthorization(w.draft.id),
      'PENDING',
      'a different tuple',
    );
    w.snapshot.mandate = { ...w.snapshot.mandate, expiresAt: w.snapshot.mandate.expiresAt - 1n };
    assert.equal(await w.orchestrator.verifyAuthorization(w.draft.id), 'AUTHORIZED');
    const m = await w.mandate();
    assert.equal(m.status, 'AUTHORIZED');
    assert.equal(m.onchainVersion?.toFixed(0), '1');
    assert.ok(m.fundedAtBlock, 'idle funds already cover the approved amount');
    assert.equal(
      (await db.intent.findUniqueOrThrow({ where: { id: w.intent.id } })).state,
      'AUTHORIZED',
    );
    assert.ok(await db.job.findUnique({ where: { key: `evaluate:${w.draft.id}:authorized` } }));
    assert.equal(await w.orchestrator.verifyAuthorization(w.draft.id), 'SKIPPED', 'idempotent');
  });
});

describe('agent loop', () => {
  async function authorized(mode: WorkerMode = 'execute') {
    const w = await world(mode);
    w.authorizeOnChain();
    assert.equal(await w.orchestrator.verifyAuthorization(w.draft.id), 'AUTHORIZED');
    return w;
  }

  test('T04 and T05: deposit, confirm, hold, then a verified risk event withdraws to the owner', async () => {
    const w = await authorized();
    assert.equal(await w.orchestrator.evaluateMandate(w.draft.id, 'tick'), 'PROPOSED');
    let [deposit] = await w.proposals();
    assert.equal(deposit?.state, 'POLICY_CHECKED');
    assert.equal(deposit?.kind, 'DEPOSIT');
    assert.equal(deposit?.amount.toFixed(0), '300000000');
    const checks = await db.policyCheck.findMany({ where: { actionId: deposit!.actionId } });
    assert.deepEqual(
      checks.map((c) => c.passed),
      [true],
    );
    assert.ok(await db.job.findUnique({ where: { key: `execute:${deposit!.actionId}` } }));
    // Serial per executor: nothing else is proposed while the deposit is open.
    assert.equal(await w.orchestrator.evaluateMandate(w.draft.id, 'tick'), 'BUSY');

    assert.equal(await w.orchestrator.executeAction(deposit!.actionId, false), 'BROADCAST');
    assert.equal(w.chain.sent.length, 1);
    w.chain.mine(w.chain.sent[0] as Hex);
    assert.equal(await w.orchestrator.executeAction(deposit!.actionId, false), 'CONFIRMED');
    [deposit] = await w.proposals();
    assert.equal(deposit?.state, 'CONFIRMED');
    const broadcast = await db.activityEvent.findFirst({
      where: { ownerId: w.owner.id, type: 'ACTION_CONFIRMED' },
    });
    assert.match(broadcast?.txHash ?? '', /^0x[0-9a-f]{64}$/);

    // Periodic evaluation never deposits again.
    assert.equal(await w.orchestrator.evaluateMandate(w.draft.id, 'tick'), 'HOLD');
    assert.equal((await w.proposals()).length, 1);

    // The vault admin degrades the vault; the monitor records the canonical event.
    w.snapshot.liquid.riskLevel = 1;
    w.snapshot.liquid.maxWithdraw = 200_000_000n;
    const event = await db.riskEvent.create({
      data: {
        chainId: 84532,
        txHash: `0xfeed${randomBytes(30).toString('hex')}`,
        logIndex: 0,
        blockNumber: '101',
        blockHash: `0x${randomBytes(32).toString('hex')}`,
        source: w.chain.liquid.toLowerCase(),
        eventRiskLevel: 1,
        eventCapacity: '200000000',
        observedAtBlock: '105',
        observedAtBlockHash: `0x${randomBytes(32).toString('hex')}`,
        currentRiskLevel: 1,
        currentCapacity: '200000000',
      },
    });
    assert.ok((await w.orchestrator.fanOutRisk(event.id)) >= 1);
    assert.equal(await w.orchestrator.evaluateMandate(w.draft.id, 'risk'), 'PROPOSED');
    const withdraw = (await w.proposals())[1]!;
    assert.equal(withdraw.kind, 'WITHDRAW');
    assert.equal(withdraw.amount.toFixed(0), '200000000', 'bounded by remaining capacity');
    assert.equal(await w.orchestrator.executeAction(withdraw.actionId, false), 'BROADCAST');
    w.chain.mine(w.chain.sent[1] as Hex);
    assert.equal(await w.orchestrator.executeAction(withdraw.actionId, false), 'CONFIRMED');
    // The rest stays monitored: the next evaluation sees zero capacity and escalates.
    assert.equal(await w.orchestrator.evaluateMandate(w.draft.id, 'tick'), 'ESCALATE');
    const m = await w.mandate();
    assert.equal(m.escalationReason, 'NO_WITHDRAWAL_CAPACITY');
    const types = await w.activity();
    for (const expected of [
      'MANDATE_AUTHORIZED',
      'ACTION_PROPOSED',
      'ACTION_BROADCAST',
      'ACTION_CONFIRMED',
      'DECISION_HOLD',
      'RISK_EVENT_OBSERVED',
      'DECISION_ESCALATE',
    ])
      assert.ok(types.includes(expected), `missing ${expected}`);
  });

  test('missing funding holds once (deduplicated) and pause blocks proposals', async () => {
    const w = await authorized();
    w.snapshot.idleBalance = 0n;
    assert.equal(await w.orchestrator.evaluateMandate(w.draft.id, 'tick'), 'HOLD');
    assert.equal(await w.orchestrator.evaluateMandate(w.draft.id, 'tick'), 'HOLD');
    const decisions = await db.decision.findMany({ where: { mandateId: w.draft.id } });
    assert.deepEqual(
      decisions.map((d) => d.reasonCode),
      ['AWAITING_FUNDING'],
    );
    w.snapshot.idleBalance = 300_000_000n;
    w.snapshot.paused = true;
    assert.equal(await w.orchestrator.evaluateMandate(w.draft.id, 'tick'), 'HOLD');
    assert.equal((await w.proposals()).length, 0);
  });

  test('T06: a locked position under a risk warning escalates instead of withdrawing', async () => {
    const w = await authorized();
    Object.assign(w.snapshot, {
      idleBalance: 0n,
      allocationCompleted: true,
      cumulativeDeposited: 300_000_000n,
    });
    Object.assign(w.snapshot.liquid, {
      principal: 300_000_000n,
      riskLevel: 1,
      unlockAt: w.chain.now + 3600n,
      maxWithdraw: 0n,
    });
    assert.equal(await w.orchestrator.evaluateMandate(w.draft.id, 'risk'), 'ESCALATE');
    assert.equal((await w.mandate()).escalationReason, 'POSITION_LOCKED');
    assert.equal((await w.proposals()).length, 0);
  });

  test('T09/T16: revocation and replacement on-chain stop the agent', async () => {
    const w = await authorized();
    w.snapshot.revoked = true;
    assert.equal(await w.orchestrator.evaluateMandate(w.draft.id, 'tick'), 'REVOKED');
    assert.equal((await w.mandate()).status, 'REVOKED');
    assert.equal(await w.orchestrator.evaluateMandate(w.draft.id, 'tick'), 'SKIPPED');
    const other = await authorized();
    other.snapshot.mandateVersion = 2n;
    assert.equal(await other.orchestrator.evaluateMandate(other.draft.id, 'tick'), 'SUPERSEDED');
    assert.equal((await w.proposals()).length + (await other.proposals()).length, 0);
  });

  test('two workers evaluating at once create exactly one proposal', async () => {
    const w = await authorized();
    const results = await Promise.all([
      w.make().evaluateMandate(w.draft.id, 'tick'),
      w.make().evaluateMandate(w.draft.id, 'tick'),
      w.make().evaluateMandate(w.draft.id, 'tick'),
    ]);
    assert.equal(results.filter((r) => r === 'PROPOSED').length, 1);
    assert.equal((await w.proposals()).length, 1);
  });

  test('a pause after proposal is enforced at dispatch: rejected, nothing signed, slot freed', async () => {
    const w = await authorized();
    assert.equal(await w.orchestrator.evaluateMandate(w.draft.id, 'tick'), 'PROPOSED');
    const [p] = await w.proposals();
    w.snapshot.paused = true;
    assert.equal(await w.orchestrator.executeAction(p!.actionId, false), 'REJECTED');
    const row = await db.actionProposal.findUniqueOrThrow({ where: { actionId: p!.actionId } });
    assert.equal(row.rejectionCode, 'INACTIVE_MANDATE');
    assert.equal(w.chain.sent.length, 0);
    assert.equal(await db.transactionAttempt.count({ where: { actionId: p!.actionId } }), 0);
    w.snapshot.paused = false;
    assert.equal(await w.orchestrator.evaluateMandate(w.draft.id, 'tick'), 'PROPOSED');
  });

  test('a monitor-only worker records intent but never proposes a transaction', async () => {
    const w = await authorized('monitor_only');
    assert.equal(await w.orchestrator.evaluateMandate(w.draft.id, 'tick'), 'EXECUTION_DISABLED');
    assert.equal((await w.proposals()).length, 0);
    const [decision] = await db.decision.findMany({ where: { mandateId: w.draft.id } });
    assert.equal(decision?.reasonCode, 'EXECUTION_DISABLED_DEPOSIT');
  });

  test('the scheduler and job runner drive verification and evaluation end to end', async () => {
    const w = await world();
    w.authorizeOnChain();
    await w.orchestrator.schedule(10_000);
    const verify = await db.job.findFirst({
      where: {
        kind: JOB.VERIFY_AUTHORIZATION,
        key: { startsWith: `verify-authorization:${w.draft.id}:` },
      },
    });
    assert.ok(verify);
    const warnings: string[] = [];
    // The queue is shared with other tests: only this world's jobs reach its fake chain.
    const ours = async (payload: unknown) => {
      const { mandateId, actionId } = (payload ?? {}) as { mandateId?: string; actionId?: string };
      if (mandateId) return mandateId === w.draft.id;
      if (actionId)
        return (
          (await db.actionProposal.count({ where: { actionId, mandateId: w.draft.id } })) === 1
        );
      return false;
    };
    const scoped = Object.fromEntries(
      Object.entries(handlersFor(w.orchestrator, 'execute')).map(([kind, handle]) => [
        kind,
        async (job: Parameters<typeof handle>[0]) =>
          (await ours(job.payload)) ? handle(job) : 'IGNORED',
      ]),
    );
    const runner = new JobRunner(new JobQueue(db), `test-${randomUUID()}`, scoped, {
      warn: (m) => warnings.push(m),
    });
    for (let i = 0; i < 10 && (await runner.drain(50)) > 0; i++);
    assert.equal((await w.mandate()).status, 'AUTHORIZED');
    const [p] = await w.proposals();
    assert.ok(p, 'evaluation after authorization proposes the deposit');
    assert.ok(['BROADCAST', 'POLICY_CHECKED'].includes(p.state));
    await enqueueJob(db, {
      key: `execute:${p.actionId}:again`,
      kind: JOB.EXECUTE_ACTION,
      payload: { actionId: p.actionId },
    });
    for (let i = 0; i < 10 && (await runner.drain(50)) > 0; i++);
    assert.equal(w.chain.sent.length, 1, 'repeated execute jobs never broadcast twice');
    assert.deepEqual(warnings, []);
  });
});
