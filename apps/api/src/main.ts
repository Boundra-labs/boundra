import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app.factory';
import { readConfig } from './config';

export function openApiDocument(app: NestExpressApplication) {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Boundra API')
      .setDescription(
        'Base Sepolia testnet prototype. Sign in with SIWE. The web app uses the session cookie, and its state-changing requests need X-CSRF-Token and an allowed Origin. SDK and MCP clients sign a "token" challenge and send the API token as Authorization: Bearer on owner routes (admin routes need the browser session). Amounts are base-unit strings.',
      )
      .setVersion('0.3.0')
      .addCookieAuth('__Host-boundra_session')
      .addBearerAuth()
      .build(),
  );
}

async function bootstrap() {
  const config = readConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
    bodyParser: false,
  });
  configureApp(app, config);
  if (config.NODE_ENV !== 'production') SwaggerModule.setup('api/docs', app, openApiDocument(app));
  await app.listen(config.API_PORT, config.API_HOST);
}

/** Configuration errors name settings, never values; anything else is reported by type and code only. */
function startupReason(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';
  if (/^Invalid [\w ]+configuration/.test(error.message)) return error.message;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? `${error.name} (${code})` : error.name;
}

if (require.main === module)
  void bootstrap().catch((error: unknown) => {
    console.error(
      `API startup failed: ${startupReason(error)}. Check configuration, PostgreSQL and migrations.`,
    );
    process.exitCode = 1;
  });
