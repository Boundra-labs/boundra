import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { AppConfig } from './config';

/** Shared by main.ts and the e2e tests so both run the same HTTP pipeline. */
export function configureApp(app: NestExpressApplication, config: AppConfig) {
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.useBodyParser('json', { limit: '16kb' });
  app.enableCors({ origin: new URL(config.WEB_ORIGIN).origin, credentials: true });
  if (config.TRUST_PROXY) app.set('trust proxy', 1);
  app.enableShutdownHooks();
  return app;
}
