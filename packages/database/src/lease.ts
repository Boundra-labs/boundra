import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from './generated/prisma/client';

export type SqlClient = PrismaClient | Prisma.TransactionClient;

export class LeaseBusyError extends Error {
  readonly code = 'LEASE_BUSY';
  constructor(readonly key: string) {
    super(`Lease ${key} is held by another worker`);
    this.name = 'LeaseBusyError';
  }
}

export class LeaseLostError extends Error {
  readonly code = 'LEASE_LOST';
  constructor(readonly key: string) {
    super(`Lease ${key} expired or was taken over`);
    this.name = 'LeaseLostError';
  }
}

/** Matches the worker's SignerLease port and also carries its key for fenced writes. */
export interface HeldLease {
  readonly key: string;
  readonly holder: string;
  readonly fencingToken: string;
  assertHeld(): Promise<void>;
}

export interface LeaseOptions {
  ttlMs?: number;
  waitMs?: number;
}

/**
 * Row-based leases with monotonic fencing tokens. A lease is never a database transaction:
 * holders keep it across RPC/LLM calls, renew it on a timer and prove ownership on every
 * write with `assertFenced` inside their own short transaction.
 */
export class LeaseManager {
  constructor(
    private readonly db: PrismaClient,
    private readonly defaults: Required<LeaseOptions> = { ttlMs: 30_000, waitMs: 30_000 },
  ) {
    if (defaults.ttlMs < 100 || defaults.waitMs < 0) throw new Error('Invalid lease options');
  }

  /** Single attempt; returns null when another holder's lease is still valid. */
  async tryAcquire(key: string, ttlMs = this.defaults.ttlMs): Promise<HeldLease | null> {
    const holder = randomUUID();
    const rows = await this.db.$queryRaw<{ fencingToken: bigint }[]>`
      INSERT INTO "Lease" ("key", "holder", "fencingToken", "expiresAt")
      VALUES (${key}, ${holder}, 1, now() + make_interval(secs => ${ttlMs}::double precision / 1000))
      ON CONFLICT ("key") DO UPDATE
        SET "holder" = EXCLUDED."holder",
            "fencingToken" = "Lease"."fencingToken" + 1,
            "expiresAt" = EXCLUDED."expiresAt"
        WHERE "Lease"."expiresAt" < now()
      RETURNING "fencingToken"`;
    const row = rows[0];
    if (!row) return null;
    const fencingToken = row.fencingToken.toString();
    const db = this.db;
    return {
      key,
      holder,
      fencingToken,
      async assertHeld() {
        const held = await db.$queryRaw<{ ok: number }[]>`
          SELECT 1 AS ok FROM "Lease"
          WHERE "key" = ${key} AND "fencingToken" = ${BigInt(fencingToken)} AND "expiresAt" > now()`;
        if (held.length === 0) throw new LeaseLostError(key);
      },
    };
  }

  async renew(lease: HeldLease, ttlMs = this.defaults.ttlMs): Promise<boolean> {
    const count = await this.db.$executeRaw`
      UPDATE "Lease"
      SET "expiresAt" = now() + make_interval(secs => ${ttlMs}::double precision / 1000)
      WHERE "key" = ${lease.key} AND "fencingToken" = ${BigInt(lease.fencingToken)}
        AND "expiresAt" > now()`;
    return count === 1;
  }

  async release(lease: HeldLease): Promise<void> {
    await this.db.$executeRaw`
      UPDATE "Lease" SET "expiresAt" = now() - interval '1 millisecond'
      WHERE "key" = ${lease.key} AND "fencingToken" = ${BigInt(lease.fencingToken)}`;
  }

  /** Waits (bounded) for the lease, renews it while `work` runs, and always releases it. */
  async withLease<T>(
    key: string,
    work: (lease: HeldLease) => Promise<T>,
    options: LeaseOptions = {},
  ): Promise<T> {
    const ttlMs = options.ttlMs ?? this.defaults.ttlMs;
    const waitMs = options.waitMs ?? this.defaults.waitMs;
    const deadline = Date.now() + waitMs;
    let delay = 50;
    let acquired = await this.tryAcquire(key, ttlMs);
    while (!acquired) {
      if (Date.now() >= deadline) throw new LeaseBusyError(key);
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 1_000);
      acquired = await this.tryAcquire(key, ttlMs);
    }
    const lease = acquired;
    let lost = false;
    let renewing: Promise<void> = Promise.resolve();
    const timer = setInterval(
      () => {
        renewing = renewing
          .then(async () => {
            if (!lost && !(await this.renew(lease, ttlMs))) lost = true;
          })
          .catch(() => {
            lost = true;
          });
      },
      Math.max(Math.floor(ttlMs / 3), 30),
    );
    const guarded: HeldLease = {
      key: lease.key,
      holder: lease.holder,
      fencingToken: lease.fencingToken,
      assertHeld: async () => {
        if (lost) throw new LeaseLostError(key);
        await lease.assertHeld();
      },
    };
    try {
      return await work(guarded);
    } finally {
      clearInterval(timer);
      await renewing;
      await this.release(lease).catch(() => {});
    }
  }
}

/**
 * Locks the lease row inside the caller's transaction and fails unless the caller still holds
 * it. Every fenced write runs this first, so a replaced holder can never commit.
 */
export async function assertFenced(tx: SqlClient, lease: HeldLease): Promise<void> {
  const rows = await tx.$queryRaw<{ ok: number }[]>`
    SELECT 1 AS ok FROM "Lease"
    WHERE "key" = ${lease.key} AND "fencingToken" = ${BigInt(lease.fencingToken)}
      AND "expiresAt" > now()
    FOR UPDATE`;
  if (rows.length === 0) throw new LeaseLostError(lease.key);
}

export function asHeldLease(lease: { fencingToken: string }): HeldLease {
  const held = lease as Partial<HeldLease>;
  if (typeof held.key !== 'string' || typeof held.holder !== 'string')
    throw new Error('Lease was not issued by LeaseManager');
  return lease as HeldLease;
}
