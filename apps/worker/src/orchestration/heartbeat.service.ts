import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { PrismaClient } from '@boundra/database';
import { hostname } from 'node:os';
import { DATABASE, WORKER_CONFIG } from '../runtime/tokens';
import type { WorkerConfig } from '../config';
import type { WorkerMode } from '../runtime/activation';

@Injectable()
export class HeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HeartbeatService.name);
  private readonly id = `${hostname()}:${process.pid}`;
  private timer?: ReturnType<typeof setInterval>;
  private pending: Promise<void> = Promise.resolve();
  private mode: WorkerMode = 'observe_only';

  constructor(
    @Inject(DATABASE) private readonly database: PrismaClient,
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
  ) {}

  async onModuleInit() {
    await this.database.$connect();
    await this.beat();
    this.timer = setInterval(() => {
      this.pending = this.pending
        .then(() => this.beat())
        .catch(() => {
          this.logger.error('Worker heartbeat failed; database dependency degraded');
        });
    }, this.config.WORKER_POLL_INTERVAL_MS);
  }

  /** The reported mode is what readiness and the UI show as execution status. */
  setMode(mode: WorkerMode) {
    this.mode = mode;
    this.pending = this.pending.then(() => this.beat()).catch(() => {});
  }

  private async beat() {
    await this.database.workerHeartbeat.upsert({
      where: { id: this.id },
      create: { id: this.id, mode: this.mode },
      update: { mode: this.mode, updatedAt: new Date() },
    });
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.pending;
    await this.database.workerHeartbeat.deleteMany({ where: { id: this.id } }).catch(() => {});
  }
}
