import { ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { HealthController } from './health.controller';

describe('readiness boundaries', () => {
  const makeController = (updatedAt: Date | null, failDatabase = false) => {
    const database = {
      client: {
        $queryRaw: failDatabase
          ? jest.fn().mockRejectedValue(new Error('secret database url'))
          : jest.fn().mockResolvedValue([{ ok: 1 }]),
        workerHeartbeat: {
          findFirst: jest.fn().mockResolvedValue(updatedAt ? { updatedAt } : null),
        },
      },
    };
    return new HealthController(database as unknown as DatabaseService);
  };

  beforeEach(() => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';
  });

  it('requires a fresh heartbeat and never declares execution ready', async () => {
    const result = await makeController(new Date()).ready();
    expect(result).toMatchObject({ status: 'ok', executionEnabled: false });
  });

  it.each([null, new Date(0)])('returns unavailable for missing/stale heartbeat', async (date) => {
    await expect(makeController(date).ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('does not leak database connection failures', async () => {
    await expect(makeController(new Date(), true).ready()).rejects.toThrow(
      'Database or worker not ready',
    );
  });
});
