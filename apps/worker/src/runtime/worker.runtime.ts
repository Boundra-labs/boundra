import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JobQueue, LeaseManager, type PrismaClient } from '@boundra/database';
import { hostname } from 'node:os';
import { OperatorExecutionService } from '../chain/execution';
import { RiskEventMonitor } from '../chain/monitor';
import type { WorkerConfig } from '../config';
import { AttemptCipher } from '../persistence/cipher';
import { PostgresExecutionStore } from '../persistence/execution-store';
import { PostgresMonitorStore } from '../persistence/monitor-store';
import { HeartbeatService } from '../orchestration/heartbeat.service';
import { handlersFor, JobRunner } from '../orchestration/job-runner';
import { Orchestrator } from '../orchestration/orchestrator';
import { activate, type Activation, type WorkerMode } from './activation';
import { DATABASE, WORKER_CONFIG } from './tokens';

/** Builds the orchestrator for an activation result. Exposed for tests and the e2e harness. */
export function buildWorker(
  db: PrismaClient,
  config: WorkerConfig,
  activation: Activation,
  workerId: string,
) {
  if (activation.mode === 'observe_only' || !activation.reader) return null;
  const leases = new LeaseManager(db);
  const monitor = new RiskEventMonitor(activation.reader, new PostgresMonitorStore(db, leases));
  let execution: ConstructorParameters<typeof Orchestrator>[0]['execution'];
  if (activation.mode === 'execute' && activation.operator && activation.limits) {
    const store = new PostgresExecutionStore(
      db,
      leases,
      new AttemptCipher(config.ATTEMPT_ENCRYPTION_KEY!),
    );
    execution = {
      service: new OperatorExecutionService(
        activation.reader,
        activation.operator,
        store,
        activation.limits,
      ),
      store,
      operator: activation.operator.address,
    };
  }
  const orchestrator = new Orchestrator({
    db,
    reader: activation.reader,
    mode: activation.mode,
    actionDeadlineSeconds: config.ACTION_DEADLINE_SECONDS,
    receiptReorgWindowBlocks: config.RECEIPT_REORG_WINDOW_BLOCKS,
    execution,
    monitor,
  });
  const logger = new Logger('JobRunner');
  const runner = new JobRunner(
    new JobQueue(db),
    workerId,
    handlersFor(orchestrator, activation.mode),
    {
      warn: (message) => logger.warn(message),
    },
  );
  return { orchestrator, runner };
}

@Injectable()
export class WorkerRuntime implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('WorkerRuntime');
  private readonly workerId = `${hostname()}:${process.pid}`;
  private worker: ReturnType<typeof buildWorker> = null;
  private mode: WorkerMode = 'observe_only';
  private activationFailed = false;
  private timer?: ReturnType<typeof setInterval>;
  private ticks = 0;
  private current: Promise<void> = Promise.resolve();
  private stopping = false;

  constructor(
    @Inject(DATABASE) private readonly db: PrismaClient,
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
    @Inject(HeartbeatService) private readonly heartbeat: HeartbeatService,
  ) {}

  async onModuleInit() {
    await this.activate();
    this.timer = setInterval(() => {
      if (this.stopping) return;
      this.current = this.current.then(() => this.tick());
    }, this.config.WORKER_POLL_INTERVAL_MS);
  }

  private async activate() {
    try {
      const activation = await activate(this.config);
      this.mode = activation.mode;
      this.activationFailed = false;
      this.worker = buildWorker(this.db, this.config, activation, this.workerId);
      this.logger.log(
        `Worker mode: ${activation.mode}${activation.reasons.length ? ` (${activation.reasons.join('; ')})` : ''}`,
      );
    } catch (error) {
      // A degraded RPC or untrusted deployment never crash-loops the worker: it stays
      // observe-only and retries activation periodically.
      this.mode = 'observe_only';
      this.activationFailed = true;
      this.worker = null;
      const code =
        (error as { code?: string }).code ?? (error instanceof Error ? error.name : 'ERROR');
      this.logger.error(`Activation failed (${code}); running observe-only`);
    }
    this.heartbeat.setMode(this.mode);
  }

  private async tick() {
    this.ticks++;
    try {
      if (this.activationFailed && this.ticks % 6 === 0) await this.activate();
      if (!this.worker) return;
      await this.worker.orchestrator.schedule(this.config.WORKER_POLL_INTERVAL_MS);
      while (!this.stopping && (await this.worker.runner.drain()) > 0);
    } catch (error) {
      const code =
        (error as { code?: string }).code ?? (error instanceof Error ? error.name : 'ERROR');
      this.logger.error(`Worker tick failed (${code})`);
    }
  }

  async onModuleDestroy() {
    // SIGTERM: stop claiming, let the running job finish; in-flight transactions stay reconcilable.
    this.stopping = true;
    this.worker?.runner.stop();
    if (this.timer) clearInterval(this.timer);
    await this.current;
  }
}
