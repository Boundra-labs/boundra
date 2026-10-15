import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_CONFIG, readConfig, type AppConfig } from './config';
import { ApiExceptionFilter } from './common/errors';
import { AUTH_THROTTLE } from './common/request';
import { DatabaseService } from './database.service';
import { HealthController } from './health.controller';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { SessionGuard } from './auth/session.guard';
import { CHAIN_GATEWAY, RpcChainGateway } from './chain/chain.gateway';
import { IntentsController } from './intents/intents.controller';
import { IntentsService } from './intents/intents.service';
import { TemplateWordingProvider, WORDING_PROVIDER } from './intents/wording.provider';
import { MandatesController } from './mandates/mandates.controller';
import { MandatesService } from './mandates/mandates.service';
import { AccountController } from './account/account.controller';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => readConfig() }],
  exports: [APP_CONFIG],
})
class ConfigModule {}

@Module({
  imports: [
    ConfigModule,
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        throttlers: [
          { name: 'default', ttl: 60_000, limit: config.RATE_LIMIT_PER_MINUTE },
          {
            name: 'auth',
            ttl: 60_000,
            limit: config.AUTH_RATE_LIMIT_PER_MINUTE,
            // Stricter login limit only on routes marked @AuthThrottle().
            skipIf: (context) => !Reflect.getMetadata(AUTH_THROTTLE, context.getHandler()),
          },
        ],
      }),
    }),
  ],
  controllers: [
    HealthController,
    AuthController,
    IntentsController,
    MandatesController,
    AccountController,
  ],
  providers: [
    DatabaseService,
    AuthService,
    IntentsService,
    MandatesService,
    {
      provide: CHAIN_GATEWAY,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) => new RpcChainGateway(c),
    },
    { provide: WORDING_PROVIDER, useClass: TemplateWordingProvider },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
