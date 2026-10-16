import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.factory';
import { readConfig } from './config';
import { openApiDocument } from './main';

/** Writes docs/openapi.json for frontend and review; needs no database connection. */
async function exportDocument() {
  if (!process.env.DATABASE_URL)
    process.env.DATABASE_URL = 'postgresql://openapi:openapi@localhost:5432/openapi';
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    bodyParser: false,
  });
  configureApp(app, readConfig());
  const target = resolve(__dirname, '../../../docs/openapi.json');
  writeFileSync(target, `${JSON.stringify(openApiDocument(app), null, 2)}\n`);
  await app.close();
  console.log(`Wrote ${target}`);
}

void exportDocument().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'OpenAPI export failed');
  process.exitCode = 1;
});
