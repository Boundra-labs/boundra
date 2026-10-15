import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { readConfig } from './config';

async function bootstrap() {
  const config = readConfig();
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.enableCors({ origin: config.WEB_ORIGIN, credentials: true });
  app.enableShutdownHooks();
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Boundra API')
      .setDescription(
        'Testnet scaffold. Execution and authentication endpoints are not implemented yet.',
      )
      .setVersion('0.1.0')
      .build(),
  );
  if (config.NODE_ENV !== 'production') SwaggerModule.setup('api/docs', app, document);
  await app.listen(config.API_PORT, config.API_HOST);
}

void bootstrap().catch(() => {
  console.error('API startup failed. Check configuration, PostgreSQL and migrations.');
  process.exitCode = 1;
});
