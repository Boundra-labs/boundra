import { createDatabaseClient } from '@boundra/database';
import { readWorkerConfig } from './config';
import { hostname } from 'node:os';

async function check() {
  const config = readWorkerConfig();
  const database = createDatabaseClient(config.DATABASE_URL);
  try {
    const heartbeat = await database.workerHeartbeat.findFirst({
      where: { id: { startsWith: `${hostname()}:` } },
      orderBy: { updatedAt: 'desc' },
    });
    if (
      !heartbeat ||
      Date.now() - heartbeat.updatedAt.getTime() > config.WORKER_HEARTBEAT_MAX_AGE_MS
    ) {
      throw new Error('Heartbeat missing or stale');
    }
  } finally {
    await database.$disconnect();
  }
}

void check().catch(() => {
  process.exitCode = 1;
});
