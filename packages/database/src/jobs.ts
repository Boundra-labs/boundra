import { Prisma, type PrismaClient } from './generated/prisma/client';
import type { SqlClient } from './lease';

export interface JobInput {
  key: string;
  kind: string;
  payload: Prisma.InputJsonValue;
  availableAt?: Date;
  maxAttempts?: number;
}

export interface ClaimedJob {
  id: string;
  key: string;
  kind: string;
  payload: Prisma.JsonValue;
  attempts: number;
  maxAttempts: number;
  leaseOwner: string;
}

/**
 * Inserts a job unless one with the same key already exists. Pass the transaction client of
 * the workflow change so the state update and its follow-up work commit atomically (outbox).
 * Without `availableAt` the job is due at the database's `now()`, the clock `claim` compares
 * against, so an app host whose clock runs behind the database cannot delay it.
 */
export async function enqueueJob(db: SqlClient, job: JobInput): Promise<boolean> {
  if (!job.key || job.key.length > 200) throw new Error('Invalid job key');
  const count = await db.$executeRaw`
    INSERT INTO "Job" ("id", "key", "kind", "payload", "availableAt", "maxAttempts", "updatedAt")
    VALUES (gen_random_uuid(), ${job.key}, ${job.kind}, ${JSON.stringify(job.payload)}::jsonb,
            COALESCE(${job.availableAt ?? null}::timestamptz, now()), ${job.maxAttempts ?? 5}, now())
    ON CONFLICT ("key") DO NOTHING`;
  return count === 1;
}

export class JobQueue {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Claims due jobs, and RUNNING jobs whose lease expired after a worker crash. SKIP LOCKED lets
   * concurrent workers claim disjoint jobs without blocking each other.
   */
  async claim(
    owner: string,
    options: { limit?: number; leaseMs?: number; kinds?: string[] } = {},
  ): Promise<ClaimedJob[]> {
    const limit = options.limit ?? 10;
    const leaseMs = options.leaseMs ?? 60_000;
    const kinds = options.kinds ?? null;
    await this.failExhausted();
    const rows = await this.db.$queryRaw<ClaimedJob[]>`
      UPDATE "Job"
      SET "status" = 'RUNNING',
          "leaseOwner" = ${owner},
          "leaseUntil" = now() + make_interval(secs => ${leaseMs}::double precision / 1000),
          "attempts" = "attempts" + 1,
          "updatedAt" = now()
      WHERE "id" IN (
        SELECT "id" FROM "Job"
        WHERE (("status" = 'PENDING' AND "availableAt" <= now())
               OR ("status" = 'RUNNING' AND "leaseUntil" < now()))
          AND "attempts" < "maxAttempts"
          AND (${kinds}::text[] IS NULL OR "kind" = ANY(${kinds}::text[]))
        ORDER BY "availableAt", "createdAt"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
      RETURNING "id", "key", "kind", "payload", "attempts", "maxAttempts", "leaseOwner"`;
    return rows;
  }

  /** Extends a long-running job's lease; false means another worker reclaimed it. */
  async extend(job: ClaimedJob, leaseMs = 60_000): Promise<boolean> {
    const count = await this.db.$executeRaw`
      UPDATE "Job"
      SET "leaseUntil" = now() + make_interval(secs => ${leaseMs}::double precision / 1000),
          "updatedAt" = now()
      WHERE "id" = ${job.id}::uuid AND "status" = 'RUNNING' AND "leaseOwner" = ${job.leaseOwner}`;
    return count === 1;
  }

  async complete(job: ClaimedJob, db: SqlClient = this.db): Promise<boolean> {
    const count = await db.$executeRaw`
      UPDATE "Job"
      SET "status" = 'COMPLETED', "leaseUntil" = NULL, "lastError" = NULL, "updatedAt" = now()
      WHERE "id" = ${job.id}::uuid AND "status" = 'RUNNING' AND "leaseOwner" = ${job.leaseOwner}`;
    return count === 1;
  }

  /** Reschedules with the given delay, or marks FAILED once attempts are exhausted. */
  async retry(job: ClaimedJob, error: string, delayMs: number): Promise<'RETRY' | 'FAILED'> {
    const exhausted = job.attempts >= job.maxAttempts;
    await this.db.$executeRaw`
      UPDATE "Job"
      SET "status" = ${exhausted ? 'FAILED' : 'PENDING'}::"JobStatus",
          "availableAt" = now() + make_interval(secs => ${delayMs}::double precision / 1000),
          "leaseUntil" = NULL,
          "lastError" = ${error.slice(0, 500)},
          "updatedAt" = now()
      WHERE "id" = ${job.id}::uuid AND "status" = 'RUNNING' AND "leaseOwner" = ${job.leaseOwner}`;
    return exhausted ? 'FAILED' : 'RETRY';
  }

  /** Jobs whose worker crashed on the final attempt are failed instead of retried forever. */
  async failExhausted(): Promise<number> {
    return this.db.$executeRaw`
      UPDATE "Job"
      SET "status" = 'FAILED', "lastError" = COALESCE("lastError", 'ATTEMPTS_EXHAUSTED'),
          "leaseUntil" = NULL, "updatedAt" = now()
      WHERE "status" IN ('PENDING', 'RUNNING') AND "attempts" >= "maxAttempts"
        AND ("status" = 'PENDING' OR "leaseUntil" < now())`;
  }
}

/** Bounded exponential backoff: 1s, 2s, 4s … capped at `maxMs`. */
export function backoffMs(attempts: number, maxMs = 60_000): number {
  return Math.min(1_000 * 2 ** Math.max(attempts - 1, 0), maxMs);
}
