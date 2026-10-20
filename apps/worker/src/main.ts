import 'reflect-metadata';
import { Module, type OnApplicationShutdown, Inject } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createDatabaseClient, type PrismaClient } from '@boundra/database';
import { HeartbeatService } from './orchestration/heartbeat.service';
import { WorkerRuntime } from './runtime/worker.runtime';
import { DATABASE, WORKER_CONFIG } from './runtime/tokens';
import { readWorkerConfig, type WorkerConfig } from './config';

class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: PrismaClient) {}
  async onApplicationShutdown() {
    await this.db.$disconnect();
  }
}

@Module({
  providers: [
    { provide: WORKER_CONFIG, useFactory: () => readWorkerConfig() },
    {
      provide: DATABASE,
      inject: [WORKER_CONFIG],
      useFactory: (config: WorkerConfig) => createDatabaseClient(config.DATABASE_URL),
    },
    DatabaseLifecycle,
    HeartbeatService,
    WorkerRuntime,
  ],
})
class WorkerModule {}

async function bootstrap() {
  readWorkerConfig();
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  console.log(`Boundra worker started (release ${process.env.BOUNDRA_RELEASE ?? 'dev'})`);
}

/** Configuration errors name settings, never values; anything else is reported by type and code only. */
function startupReason(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  if (/^Invalid [\w ]+configuration/.test(error.message)) return error.message;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? `${error.name} (${code})` : error.name;
}

void bootstrap().catch((error: unknown) => {
  console.error(
    `Worker startup failed: ${startupReason(error)}. Check configuration, PostgreSQL and migrations.`,
  );
  process.exitCode = 1;
});
