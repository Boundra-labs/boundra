import { backoffMs, type ClaimedJob, type JobQueue } from '@boundra/database';
import { z } from 'zod';
import { JOB, type Orchestrator } from './orchestrator';
import type { WorkerMode } from '../runtime/activation';

const uuid = z.uuid();
const mandatePayload = z.object({ mandateId: uuid, trigger: z.string().max(64).optional() });
const actionPayload = z.object({ actionId: z.string().regex(/^0x[0-9a-f]{64}$/) });
const riskPayload = z.object({ riskEventId: uuid });

export type JobHandler = (job: ClaimedJob) => Promise<unknown>;

export function handlersFor(
  orchestrator: Orchestrator,
  mode: WorkerMode,
): Record<string, JobHandler> {
  if (mode === 'observe_only') return {};
  const handlers: Record<string, JobHandler> = {
    [JOB.VERIFY_AUTHORIZATION]: (job) =>
      orchestrator.verifyAuthorization(mandatePayload.parse(job.payload).mandateId),
    [JOB.EVALUATE_MANDATE]: (job) => {
      const payload = mandatePayload.parse(job.payload);
      return orchestrator.evaluateMandate(payload.mandateId, payload.trigger ?? 'job');
    },
    [JOB.EVALUATE_RISK]: (job) =>
      orchestrator.fanOutRisk(riskPayload.parse(job.payload).riskEventId),
    [JOB.MONITOR_POLL]: () => orchestrator.monitorPoll(),
  };
  if (mode === 'execute') {
    const execute: JobHandler = (job) =>
      orchestrator.executeAction(
        actionPayload.parse(job.payload).actionId,
        job.attempts >= job.maxAttempts,
      );
    handlers[JOB.EXECUTE_ACTION] = execute;
    handlers[JOB.RECONCILE_ACTION] = execute;
  }
  return handlers;
}

export interface RunnerLog {
  warn(message: string): void;
}

/** Claims due jobs this worker can handle and runs them one at a time. */
export class JobRunner {
  private stopping = false;

  constructor(
    private readonly queue: JobQueue,
    private readonly owner: string,
    private readonly handlers: Record<string, JobHandler>,
    private readonly log: RunnerLog,
  ) {}

  stop() {
    this.stopping = true;
  }

  /** Returns the number of jobs processed (0 when idle or stopping). */
  async drain(limit = 10): Promise<number> {
    const kinds = Object.keys(this.handlers);
    if (this.stopping || kinds.length === 0) return 0;
    const jobs = await this.queue.claim(this.owner, { limit, kinds, leaseMs: 120_000 });
    for (const job of jobs) {
      if (this.stopping) {
        // Shutdown: hand claimed-but-unstarted work back immediately.
        await this.queue.retry(job, 'WORKER_SHUTDOWN', 0);
        continue;
      }
      try {
        await this.handlers[job.kind]!(job);
        await this.queue.complete(job);
      } catch (error) {
        const code =
          (error as { code?: unknown }).code &&
          typeof (error as { code: unknown }).code === 'string'
            ? (error as { code: string }).code
            : error instanceof Error
              ? error.name
              : 'UNKNOWN_ERROR';
        const outcome = await this.queue.retry(
          job,
          code,
          code === 'LEASE_BUSY' ? 2_000 : backoffMs(job.attempts),
        );
        this.log.warn(
          `${job.kind} failed (${code}); ${outcome === 'FAILED' ? 'giving up' : 'will retry'}`,
        );
      }
    }
    return jobs.length;
  }
}
