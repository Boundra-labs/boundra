import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createDatabaseClient } from '@boundra/database';
import { readConfig } from './config';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly client = createDatabaseClient(readConfig().DATABASE_URL);

  async onModuleInit() {
    await this.client.$connect();
  }
  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
