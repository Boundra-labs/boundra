import {
  asHeldLease,
  assertFenced,
  enqueueJob,
  type LeaseManager,
  type PrismaClient,
} from '@boundra/database';
import type { Hash } from 'viem';
import type { SignerLease } from '../chain/execution';
import type { MonitorCursor, MonitorStore, RiskObservation } from '../chain/monitor';

export const EVALUATE_RISK_JOB = 'EVALUATE_RISK';

export class CursorConflictError extends Error {
  readonly code = 'CURSOR_CONFLICT';
  constructor() {
    super('Monitor cursor changed concurrently');
    this.name = 'CursorConflictError';
  }
}

/** PostgreSQL implementation of the risk monitor port (docs/worker-chain-port.md). */
export class PostgresMonitorStore implements MonitorStore {
  readonly durable = true as const;

  constructor(
    private readonly db: PrismaClient,
    private readonly leases: LeaseManager,
    private readonly leaseOptions: { ttlMs?: number; waitMs?: number } = {},
  ) {}

  withMonitorLease<T>(key: string, work: (lease: SignerLease) => Promise<T>): Promise<T> {
    return this.leases.withLease(`monitor:${key.toLowerCase()}`, work, this.leaseOptions);
  }

  async readCursor(key: string): Promise<MonitorCursor | null> {
    const row = await this.db.monitorCursor.findUnique({ where: { key } });
    if (!row) return null;
    return {
      nextBlock: BigInt(row.nextBlock.toFixed(0)),
      previousBlockHash: (row.previousBlockHash as Hash | null) ?? null,
    };
  }

  async rewind(key: string, fromBlock: bigint, leaseInput: SignerLease): Promise<void> {
    const lease = asHeldLease(leaseInput);
    await this.db.$transaction(async (tx) => {
      await assertFenced(tx, lease);
      await tx.monitorCursor.upsert({
        where: { key },
        create: { key, nextBlock: fromBlock.toString(), previousBlockHash: null },
        update: { nextBlock: fromBlock.toString(), previousBlockHash: null },
      });
      // Observations from the abandoned branch are orphaned, never deleted, and their queued
      // decisions are cancelled. Already-sent transactions are left to reconciliation.
      const orphaned = await tx.$queryRaw<{ id: string }[]>`
        UPDATE "RiskEvent" SET "status" = 'ORPHANED', "updatedAt" = now()
        WHERE "status" = 'CANONICAL' AND "blockNumber" >= ${fromBlock.toString()}::numeric
        RETURNING "id"::text AS "id"`;
      if (orphaned.length > 0) {
        // Pending evaluations are cancelled. Every derived job also releases its idempotency key
        // (history is kept) so a reinstated event is evaluated again.
        await tx.$executeRaw`
          UPDATE "Job"
          SET "key" = "key" || ':orphaned:' || "id"::text,
              "status" = CASE WHEN "status" = 'PENDING' THEN 'FAILED'::"JobStatus" ELSE "status" END,
              "lastError" = CASE WHEN "status" = 'PENDING' THEN 'RISK_EVENT_ORPHANED' ELSE "lastError" END,
              "updatedAt" = now()
          WHERE "kind" = ${EVALUATE_RISK_JOB} AND "key" NOT LIKE '%:orphaned:%'
            AND "payload"->>'riskEventId' = ANY(${orphaned.map((row) => row.id)}::text[])`;
      }
    });
  }

  async commitBatch(
    key: string,
    expected: MonitorCursor | null,
    next: MonitorCursor,
    observations: RiskObservation[],
    leaseInput: SignerLease,
  ): Promise<void> {
    const lease = asHeldLease(leaseInput);
    await this.db.$transaction(async (tx) => {
      await assertFenced(tx, lease);
      const nextBlock = next.nextBlock.toString();
      const nextHash = next.previousBlockHash?.toLowerCase() ?? null;
      const advanced = expected
        ? await tx.$executeRaw`
            UPDATE "MonitorCursor"
            SET "nextBlock" = ${nextBlock}::numeric, "previousBlockHash" = ${nextHash}, "updatedAt" = now()
            WHERE "key" = ${key} AND "nextBlock" = ${expected.nextBlock.toString()}::numeric
              AND "previousBlockHash" IS NOT DISTINCT FROM ${expected.previousBlockHash?.toLowerCase() ?? null}`
        : await tx.$executeRaw`
            INSERT INTO "MonitorCursor" ("key", "nextBlock", "previousBlockHash", "updatedAt")
            VALUES (${key}, ${nextBlock}::numeric, ${nextHash}, now())
            ON CONFLICT ("key") DO NOTHING`;
      if (advanced !== 1) throw new CursorConflictError();
      for (const o of observations) {
        // Overlap rescans hit the unique event identity and produce nothing new; a previously
        // orphaned event that is canonical again is reinstated and evaluated again.
        const rows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO "RiskEvent" ("id", "chainId", "txHash", "logIndex", "blockNumber", "blockHash",
            "source", "eventRiskLevel", "eventCapacity", "observedAtBlock", "observedAtBlockHash",
            "currentRiskLevel", "currentCapacity", "status", "updatedAt")
          VALUES (gen_random_uuid(), ${o.chainId}, ${o.transactionHash.toLowerCase()}, ${o.logIndex},
            ${o.blockNumber.toString()}::numeric, ${o.blockHash.toLowerCase()}, ${o.source.toLowerCase()},
            ${o.eventRiskLevel}, ${o.eventCapacity.toString()}::numeric, ${o.observedAtBlock.toString()}::numeric,
            ${o.observedAtBlockHash.toLowerCase()}, ${o.currentRiskLevel}, ${o.currentCapacity.toString()}::numeric,
            'CANONICAL', now())
          ON CONFLICT ("chainId", "txHash", "logIndex") DO UPDATE
            SET "status" = 'CANONICAL', "blockNumber" = EXCLUDED."blockNumber",
                "blockHash" = EXCLUDED."blockHash", "observedAtBlock" = EXCLUDED."observedAtBlock",
                "observedAtBlockHash" = EXCLUDED."observedAtBlockHash",
                "currentRiskLevel" = EXCLUDED."currentRiskLevel",
                "currentCapacity" = EXCLUDED."currentCapacity", "updatedAt" = now()
            WHERE "RiskEvent"."status" = 'ORPHANED'
          RETURNING "id"::text AS "id"`;
        const inserted = rows[0];
        if (!inserted) continue;
        await enqueueJob(tx, {
          key: `risk:${inserted.id}:${o.blockHash.toLowerCase()}`,
          kind: EVALUATE_RISK_JOB,
          payload: { riskEventId: inserted.id, source: o.source.toLowerCase() },
        });
      }
    });
  }
}
