import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { HeartbeatService } from './orchestration/heartbeat.service';
import { readWorkerConfig } from './config';

@Module({ providers: [HeartbeatService] })
class WorkerModule {}

async function bootstrap() {
  readWorkerConfig();
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
}

void bootstrap().catch(() => {
  console.error('Worker startup failed. Check configuration, PostgreSQL and migrations.');
  process.exitCode = 1;
});
