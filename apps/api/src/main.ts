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
        'Base Sepolia testnet prototype. Session cookie auth via SIWE; state-changing requests need X-CSRF-Token and an allowed Origin. Amounts are base-unit strings.',
      )
      .setVersion('0.2.0')
      .addCookieAuth('__Host-boundra_session')
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

if (require.main === module)
  void bootstrap().catch(() => {
    console.error('API startup failed. Check configuration, PostgreSQL and migrations.');
    process.exitCode = 1;
  });
