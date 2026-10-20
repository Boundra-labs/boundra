import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { buildMandate, hashPreview, MandateBuildError, ONE_DAY } from '@boundra/acce';
import { summarizeMandate, type LlmProvider } from '@boundra/llm';
import { hashMandate } from '@boundra/chain';
import { enqueueJob, type Mandate } from '@boundra/database';
import {
  addressSchema,
  hashSchema,
  mandateTupleFromRow,
  tokenAmountSchema,
  type MandateTuple,
} from '@boundra/shared';
import { z } from 'zod';
import { ApiError, invalidState, notFound } from '../common/errors';
import { isUuid, parse, type AuthenticatedOwner } from '../common/request';
import { DatabaseService } from '../database.service';
import { CHAIN_GATEWAY, chainUnavailable, type ChainGateway } from '../chain/chain.gateway';
import { IntentsService, stateFromQuestions } from '../intents/intents.service';
import { LLM_PROVIDER } from '../intents/wording.provider';

export const VERIFY_AUTHORIZATION_JOB = 'VERIFY_AUTHORIZATION';

export const draftSchema = z
  .object({
    expiryDays: z.number().int().min(1).max(60).optional(),
    maxDepositPerAction: tokenAmountSchema.optional(),
    maxWithdrawPerAction: tokenAmountSchema.optional(),
    /** The owner's own agent; omitted means Boundra's agent (or, when editing, the same agent). */
    operator: addressSchema.optional(),
  })
  .strict();
export const approveSchema = z.object({ previewHash: hashSchema }).strict();
export const authorizationCheckSchema = z.object({ txHash: hashSchema.optional() }).strict();

export const tupleOf = (row: Mandate): MandateTuple => mandateTupleFromRow(row);

const ACTIVE_DRAFT = ['DRAFT', 'PREVIEWED', 'APPROVED'] as const;

@Injectable()
export class MandatesService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CHAIN_GATEWAY) private readonly chain: ChainGateway,
    @Inject(IntentsService) private readonly intents: IntentsService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  private get db() {
    return this.database.client;
  }

  /** Builds a new draft revision; every edit is a new revision that needs its own approval. */
  async createDraft(owner: AuthenticatedOwner, intentId: string, body: unknown) {
    const input = parse(draftSchema, body ?? {});
    const intent = await this.intents.load(owner, intentId);
    if (intent.state !== 'MANDATE_PENDING')
      throw invalidState('Finish clarification before drafting a mandate');
    const deployment = this.chain.deployment();
    if (!deployment) throw chainUnavailable();
    const executor = await this.db.executor.findUnique({ where: { ownerId: owner.id } });
    if (!executor)
      throw new ApiError(
        HttpStatus.CONFLICT,
        'EXECUTOR_NOT_REGISTERED',
        'Your executor is not registered yet',
        'Call createExecutor() on the factory from your wallet, then POST /executors/register.',
      );
    const operator = this.chooseOperator(input.operator, deployment);
    const questions = await this.db.question.findMany({
      where: { intentId },
      orderBy: { order: 'asc' },
    });
    let result: ReturnType<typeof buildMandate>;
    try {
      result = buildMandate({
        owner: owner.address,
        operator: operator.address,
        ownerChosenOperator: operator.ownerChosen,
        asset: deployment.manifest.mockUsdc,
        executor: executor.address,
        vaultAddresses: {
          LIQUID: deployment.manifest.liquidVault,
          TIMED: deployment.manifest.timedVault,
        },
        amount: BigInt(intent.amount.toFixed(0)),
        state: stateFromQuestions(questions),
        nowSeconds: BigInt(Math.floor(Date.now() / 1000)),
        expirySeconds: input.expiryDays ? BigInt(input.expiryDays) * ONE_DAY : undefined,
        maxDepositPerAction: input.maxDepositPerAction
          ? BigInt(input.maxDepositPerAction)
          : undefined,
        maxWithdrawPerAction: input.maxWithdrawPerAction
          ? BigInt(input.maxWithdrawPerAction)
          : undefined,
      });
    } catch (error) {
      if (error instanceof MandateBuildError)
        throw new ApiError(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_FAILED',
          `Invalid mandate: ${error.code}`,
        );
      throw error;
    }
    if (!result.ok) {
      await this.db.$transaction([
        this.db.intent.update({ where: { id: intentId }, data: { state: 'ESCALATED' } }),
        this.db.activityEvent.create({
          data: {
            ownerId: owner.id,
            intentId,
            type: 'INTENT_ESCALATED',
            payload: { reasonCode: result.selection.reasonCode, reason: result.selection.reason },
          },
        }),
      ]);
      return {
        status: 'ESCALATED',
        reasonCode: result.selection.reasonCode,
        reason: result.selection.reason,
      };
    }
    const { tuple, preview, selection } = result;
    // The summary is generated before the transaction and hashed with the preview it describes.
    const summary = await summarizeMandate(this.llm, preview);
    preview.plainSummary = { text: summary.value, source: summary.source };
    const previewHash = hashPreview(preview);
    const draft = await this.db.$transaction(async (tx) => {
      const latest = await tx.mandate.findFirst({
        where: { intentId },
        orderBy: { revision: 'desc' },
        select: { revision: true },
      });
      await tx.mandate.updateMany({
        where: { intentId, status: { in: [...ACTIVE_DRAFT] } },
        data: { status: 'SUPERSEDED' },
      });
      const created = await tx.mandate.create({
        data: {
          intentId,
          ownerId: owner.id,
          executorId: executor.id,
          revision: (latest?.revision ?? 0) + 1,
          status: 'PREVIEWED',
          chainId: tuple.chainId,
          asset: tuple.asset,
          operator: tuple.operator,
          beneficiary: tuple.beneficiary,
          expiresAt: tuple.expiresAt,
          allowedVaults: tuple.allowedVaults,
          allowedActions: tuple.allowedActions,
          maxLockupSeconds: BigInt(tuple.maxLockupSeconds),
          maxDepositPerAction: tuple.maxDepositPerAction,
          maxCumulativeDeposits: tuple.maxCumulativeDeposits,
          maxWithdrawPerAction: tuple.maxWithdrawPerAction,
          allocationTarget: tuple.allocationTarget,
          selectedVault: selection.vault,
          preview: preview as object,
          previewHash,
        },
      });
      await tx.activityEvent.create({
        data: {
          ownerId: owner.id,
          intentId,
          mandateId: created.id,
          type: 'MANDATE_PREVIEWED',
          payload: {
            revision: created.revision,
            vault: selection.vault,
            previewHash,
            summary: { source: summary.source, fallbackReason: summary.fallbackReason },
          },
        },
      });
      return created;
    });
    return this.view(draft);
  }

  async revise(owner: AuthenticatedOwner, draftId: string, body: unknown) {
    const input = parse(draftSchema, body);
    const draft = await this.load(owner, draftId);
    // Editing limits never swaps the agent behind the owner's back.
    return this.createDraft(owner, draft.intentId, {
      ...input,
      operator: input.operator ?? draft.operator,
    });
  }

  /**
   * The owner may name their own agent. It can never be a Boundra contract or the risk admin;
   * the ACCE builder and the executor contract also refuse the owner and the executor itself.
   */
  private chooseOperator(
    requested: string | undefined,
    deployment: NonNullable<ReturnType<ChainGateway['deployment']>>,
  ) {
    const boundra = deployment.operator?.toLowerCase() ?? null;
    const address = requested?.toLowerCase() ?? boundra;
    if (!address)
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'This deployment runs no Boundra agent, so the mandate needs your own operator',
        'Send the address of the agent you run as `operator`.',
      );
    const { manifest } = deployment;
    const reserved = [
      manifest.factory,
      manifest.mockUsdc,
      manifest.faucet,
      manifest.liquidVault,
      manifest.timedVault,
      manifest.riskAdmin,
    ].map((value) => value.toLowerCase());
    if (reserved.includes(address))
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'Invalid mandate: OPERATOR_NOT_ALLOWED',
        'The operator must be your agent’s own address, not a Boundra contract or the risk admin.',
      );
    return { address, ownerChosen: address !== boundra };
  }

  async get(owner: AuthenticatedOwner, draftId: string) {
    return this.view(await this.load(owner, draftId));
  }

  /** Approval binds the exact previewed revision; the mandate is still inactive until on-chain. */
  async approve(owner: AuthenticatedOwner, draftId: string, body: unknown) {
    const { previewHash } = parse(approveSchema, body);
    const draft = await this.load(owner, draftId);
    if (draft.status !== 'PREVIEWED')
      throw invalidState(`A ${draft.status.toLowerCase()} mandate cannot be approved`);
    const stale = (message: string) =>
      new ApiError(
        HttpStatus.CONFLICT,
        'STALE_PREVIEW',
        message,
        'Reload the latest preview and review it again.',
      );
    if (draft.previewHash !== previewHash.toLowerCase())
      throw stale('The preview you approved does not match the current draft');
    if (BigInt(draft.expiresAt.toFixed(0)) <= BigInt(Math.floor(Date.now() / 1000)) + 3_600n)
      throw stale('This draft expires too soon; create a fresh draft');
    const executor = await this.db.executor.findUnique({ where: { ownerId: owner.id } });
    if (!executor || executor.id !== draft.executorId)
      throw invalidState('The registered executor changed; create a fresh draft');
    const mandateHash = hashMandate(tupleOf(draft));
    const updated = await this.db.$transaction(async (tx) => {
      const result = await tx.mandate.updateMany({
        where: { id: draft.id, status: 'PREVIEWED', previewHash: draft.previewHash },
        data: { status: 'APPROVED', approvedAt: new Date(), mandateHash },
      });
      if (result.count !== 1) throw stale('The draft changed while you were approving it');
      await tx.activityEvent.create({
        data: {
          ownerId: owner.id,
          intentId: draft.intentId,
          mandateId: draft.id,
          type: 'MANDATE_APPROVED',
          payload: { revision: draft.revision, mandateHash, previewHash: draft.previewHash },
        },
      });
      return tx.mandate.findUniqueOrThrow({ where: { id: draft.id } });
    });
    return {
      ...(await this.view(updated)),
      ownerTransactions: {
        note: 'Approval here does not activate the agent. Send these from your wallet; the agent starts only after both are confirmed on-chain.',
        setMandate: { to: executor.address, functionName: 'setMandate', args: [tupleOf(updated)] },
        approve: {
          to: updated.asset,
          functionName: 'approve',
          args: [executor.address, updated.allocationTarget.toFixed(0)],
        },
        fund: {
          to: executor.address,
          functionName: 'fund',
          args: [updated.allocationTarget.toFixed(0)],
        },
      },
    };
  }

  /** Queues on-chain verification; AUTHORIZED is only ever set by the worker from chain state. */
  async requestAuthorizationCheck(owner: AuthenticatedOwner, draftId: string, body: unknown) {
    const { txHash } = parse(authorizationCheckSchema, body ?? {});
    const draft = await this.load(owner, draftId);
    if (draft.status === 'AUTHORIZED')
      return { status: 'AUTHORIZED', mandate: await this.view(draft) };
    if (draft.status !== 'APPROVED')
      throw invalidState('Only an approved mandate can be checked for on-chain authorization');
    await this.db.$transaction(async (tx) => {
      if (txHash)
        await tx.mandate.update({
          where: { id: draft.id },
          data: { authorizationTxHash: txHash.toLowerCase() },
        });
      await enqueueJob(tx, {
        key: `verify-authorization:${draft.id}:${Math.floor(Date.now() / 10_000)}`,
        kind: VERIFY_AUTHORIZATION_JOB,
        payload: { mandateId: draft.id },
      });
      await tx.activityEvent.create({
        data: {
          ownerId: owner.id,
          intentId: draft.intentId,
          mandateId: draft.id,
          type: 'AUTHORIZATION_CHECK_REQUESTED',
          payload: { txHash: txHash?.toLowerCase() ?? null },
          txHash: txHash?.toLowerCase() ?? null,
        },
      });
    });
    return { status: 'PENDING_VERIFICATION' };
  }

  private async load(owner: AuthenticatedOwner, draftId: string) {
    const draft = isUuid(draftId)
      ? await this.db.mandate.findFirst({ where: { id: draftId, ownerId: owner.id } })
      : null;
    if (!draft) throw notFound('Mandate');
    return draft;
  }

  private async view(draft: Mandate) {
    const executor = draft.executorId
      ? await this.db.executor.findUnique({ where: { id: draft.executorId } })
      : null;
    return {
      id: draft.id,
      intentId: draft.intentId,
      revision: draft.revision,
      status: draft.status,
      executor: executor?.address ?? null,
      tuple: tupleOf(draft),
      preview: draft.preview,
      previewHash: draft.previewHash,
      mandateHash: draft.mandateHash,
      approvedAt: draft.approvedAt?.toISOString() ?? null,
      authorizedAt: draft.authorizedAt?.toISOString() ?? null,
      onchainVersion: draft.onchainVersion?.toFixed(0) ?? null,
      authorizationTxHash: draft.authorizationTxHash,
      fundedAtBlock: draft.fundedAtBlock?.toFixed(0) ?? null,
      escalationReason: draft.escalationReason,
    };
  }
}
