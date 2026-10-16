import {
  asHeldLease,
  assertFenced,
  type HeldLease,
  type LeaseManager,
  type PrismaClient,
} from '@boundra/database';
import type { ActionRequest } from '@boundra/chain';
import type { Address, Hash, Hex } from 'viem';
import type { AttemptState, ExecutionStore, SignedAttempt, SignerLease } from '../chain/execution';
import type { AttemptCipher } from './cipher';

export class AttemptConflictError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'AttemptConflictError';
  }
}

interface AttemptRow {
  actionId: string;
  requestHash: string;
  action: ActionRequest;
  owner: string;
  executor: string;
  operator: string;
  eoaNonce: bigint;
  rawTxCiphertext: Uint8Array;
  txHash: string;
  signedAtBlock: { toFixed(digits: number): string };
  state: AttemptState;
}

/** Signer leases are keyed `signer:<chainId>:<operator>` (the service passes `<chainId>:<operator>`). */
function signerOf(lease: HeldLease): { chainId: number; operator: string } {
  const [prefix, chainId, operator] = lease.key.split(':');
  if (prefix !== 'signer' || !chainId || !operator || !/^0x[0-9a-f]{40}$/.test(operator))
    throw new Error('Not a signer lease');
  return { chainId: Number(chainId), operator };
}

/** PostgreSQL implementation of the chain execution port (docs/worker-chain-port.md). */
export class PostgresExecutionStore implements ExecutionStore {
  readonly durable = true as const;

  constructor(
    private readonly db: PrismaClient,
    private readonly leases: LeaseManager,
    private readonly cipher: AttemptCipher,
    private readonly leaseOptions: { ttlMs?: number; waitMs?: number } = {},
  ) {}

  withSignerLease<T>(key: string, work: (lease: SignerLease) => Promise<T>): Promise<T> {
    return this.leases.withLease(`signer:${key.toLowerCase()}`, work, this.leaseOptions);
  }

  async findAttempt(actionId: Hash): Promise<SignedAttempt | null> {
    const row = (await this.db.transactionAttempt.findUnique({
      where: { actionId: actionId.toLowerCase() },
    })) as AttemptRow | null;
    if (!row) return null;
    return {
      actionId: row.actionId as Hash,
      requestHash: row.requestHash as Hash,
      action: row.action,
      owner: row.owner as Address,
      executor: row.executor as Address,
      operator: row.operator as Address,
      eoaNonce: Number(row.eoaNonce),
      rawTransaction: this.cipher.decrypt(row.rawTxCiphertext, row.actionId) as Hex,
      transactionHash: row.txHash as Hash,
      signedAtBlock: BigInt(row.signedAtBlock.toFixed(0)),
      state: row.state,
    };
  }

  async reserveEoaNonce(
    actionIdInput: Hash,
    minimumPendingNonce: number,
    leaseInput: SignerLease,
  ): Promise<number> {
    const lease = asHeldLease(leaseInput);
    const { chainId, operator } = signerOf(lease);
    const actionId = actionIdInput.toLowerCase();
    const fencing = BigInt(lease.fencingToken);
    return this.db.$transaction(async (tx) => {
      await assertFenced(tx, lease);
      const existing = await tx.eoaNonceReservation.findUnique({ where: { actionId } });
      if (existing && existing.status !== 'RELEASED') {
        if (existing.operator !== operator) throw new AttemptConflictError('OPERATOR_CONFLICT');
        return Number(existing.eoaNonce);
      }
      // A previous holder that reserved but never persisted a signed attempt is fenced out by
      // our newer token, so its unsigned reservation can be reclaimed safely.
      await tx.$executeRaw`
        UPDATE "EoaNonceReservation" r SET "status" = 'RELEASED', "updatedAt" = now()
        WHERE r."chainId" = ${chainId} AND r."operator" = ${operator} AND r."status" = 'RESERVED'
          AND r."fencingToken" < ${fencing}
          AND NOT EXISTS (SELECT 1 FROM "TransactionAttempt" a WHERE a."actionId" = r."actionId")`;
      const active = await tx.eoaNonceReservation.findMany({
        where: {
          chainId,
          operator,
          status: { not: 'RELEASED' },
          eoaNonce: { gte: BigInt(minimumPendingNonce) },
        },
        select: { eoaNonce: true },
        orderBy: { eoaNonce: 'asc' },
      });
      // Smallest free nonce at or above the chain's pending nonce, filling released gaps first.
      let nonce = BigInt(minimumPendingNonce);
      for (const row of active) {
        if (row.eoaNonce === nonce) nonce++;
        else if (row.eoaNonce > nonce) break;
      }
      if (existing) {
        await tx.eoaNonceReservation.update({
          where: { actionId },
          data: { operator, eoaNonce: nonce, status: 'RESERVED', fencingToken: fencing },
        });
      } else {
        await tx.eoaNonceReservation.create({
          data: { chainId, operator, eoaNonce: nonce, actionId, fencingToken: fencing },
        });
      }
      return Number(nonce);
    });
  }

  async saveSignedAttempt(attempt: SignedAttempt, leaseInput: SignerLease): Promise<void> {
    const lease = asHeldLease(leaseInput);
    const { chainId, operator } = signerOf(lease);
    const actionId = attempt.actionId.toLowerCase();
    if (attempt.operator.toLowerCase() !== operator)
      throw new AttemptConflictError('OPERATOR_CONFLICT');
    await this.db.$transaction(async (tx) => {
      await assertFenced(tx, lease);
      const reservation = await tx.eoaNonceReservation.findUnique({ where: { actionId } });
      if (
        !reservation ||
        reservation.status !== 'RESERVED' ||
        reservation.eoaNonce !== BigInt(attempt.eoaNonce)
      )
        throw new AttemptConflictError('NONCE_NOT_RESERVED');
      await tx.transactionAttempt.create({
        data: {
          actionId,
          chainId,
          requestHash: attempt.requestHash.toLowerCase(),
          action: attempt.action as object,
          owner: attempt.owner.toLowerCase(),
          executor: attempt.executor.toLowerCase(),
          operator,
          eoaNonce: BigInt(attempt.eoaNonce),
          contractNonce: attempt.action.nonce,
          rawTxCiphertext: new Uint8Array(this.cipher.encrypt(attempt.rawTransaction, actionId)),
          txHash: attempt.transactionHash.toLowerCase(),
          signedAtBlock: attempt.signedAtBlock.toString(),
          state: attempt.state,
          fencingToken: BigInt(lease.fencingToken),
        },
      });
      await tx.eoaNonceReservation.update({
        where: { actionId },
        data: { status: 'SIGNED', fencingToken: BigInt(lease.fencingToken) },
      });
      await tx.attemptEvent.create({ data: { actionId, state: attempt.state } });
    });
  }

  async reserveBroadcast(
    actionId: Hash,
    maxAttempts: number,
    minIntervalMs: number,
    leaseInput: SignerLease,
  ): Promise<boolean> {
    const lease = asHeldLease(leaseInput);
    return this.db.$transaction(async (tx) => {
      await assertFenced(tx, lease);
      // The send is counted before any network I/O, so a crash cannot reset the retry budget.
      const count = await tx.$executeRaw`
        UPDATE "TransactionAttempt"
        SET "sendCount" = "sendCount" + 1, "lastSendAt" = now(),
            "fencingToken" = ${BigInt(lease.fencingToken)}, "updatedAt" = now()
        WHERE "actionId" = ${actionId.toLowerCase()} AND "sendCount" < ${maxAttempts}
          AND ("lastSendAt" IS NULL
               OR "lastSendAt" <= now() - make_interval(secs => ${minIntervalMs}::double precision / 1000))`;
      return count === 1;
    });
  }

  async recordState(
    actionIdInput: Hash,
    state: AttemptState,
    detail: { code?: string; blockNumber?: string; blockHash?: Hash },
    leaseInput: SignerLease,
  ): Promise<void> {
    const lease = asHeldLease(leaseInput);
    const actionId = actionIdInput.toLowerCase();
    await this.db.$transaction(async (tx) => {
      await assertFenced(tx, lease);
      const updated = await tx.transactionAttempt.updateMany({
        where: { actionId },
        data: {
          state,
          lastCode: detail.code ?? null,
          fencingToken: BigInt(lease.fencingToken),
          ...(detail.blockNumber !== undefined
            ? {
                receiptBlockNumber: detail.blockNumber,
                receiptBlockHash: detail.blockHash?.toLowerCase() ?? null,
              }
            : {}),
        },
      });
      if (updated.count !== 1) throw new AttemptConflictError('ATTEMPT_NOT_FOUND');
      await tx.attemptEvent.create({
        data: {
          actionId,
          state,
          code: detail.code ?? null,
          blockNumber: detail.blockNumber ?? null,
          blockHash: detail.blockHash?.toLowerCase() ?? null,
        },
      });
    });
  }
}
