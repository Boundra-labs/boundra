import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createDatabaseClient } from '@boundra/database';
import { hostname } from 'node:os';
import { readWorkerConfig } from '../config';

@Injectable()
export class HeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HeartbeatService.name);
  private readonly config = readWorkerConfig();
  private readonly database = createDatabaseClient(this.config.DATABASE_URL);
  private readonly id = `${hostname()}:${process.pid}`;
  private timer?: ReturnType<typeof setInterval>;
  private pending: Promise<void> = Promise.resolve();

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
    this.logger.log(
      'Worker started in observe-only mode; signing and job execution are not implemented',
    );
  }

  private async beat() {
    await this.database.workerHeartbeat.upsert({
      where: { id: this.id },
      create: { id: this.id, mode: 'observe_only' },
      update: { mode: 'observe_only', updatedAt: new Date() },
    });
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.pending;
    try {
      await this.database.workerHeartbeat.deleteMany({ where: { id: this.id } });
    } finally {
      await this.database.$disconnect();
    }
  }
}
