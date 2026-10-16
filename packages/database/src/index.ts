import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

export * from './generated/prisma/client';
export * from './lease';
export * from './jobs';

export function createDatabaseClient(connectionString: string): PrismaClient {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use PostgreSQL');
  }
  const adapter = new PrismaPg({ connectionString, connectionTimeoutMillis: 5000, max: 5 });
  return new PrismaClient({ adapter, log: ['error'] });
}
