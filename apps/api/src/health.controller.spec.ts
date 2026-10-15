import { ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { HealthController } from './health.controller';

describe('readiness boundaries', () => {
  const makeController = (updatedAt: Date | null, failDatabase = false, mode = 'observe_only') => {
    const database = {
      client: {
        $queryRaw: failDatabase
          ? jest.fn().mockRejectedValue(new Error('secret database url'))
          : jest.fn().mockResolvedValue([{ ok: 1 }]),
        workerHeartbeat: {
          findFirst: jest.fn().mockResolvedValue(updatedAt ? { updatedAt, mode } : null),
        },
      },
    };
    return new HealthController(database as unknown as DatabaseService);
  };

  beforeEach(() => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost/test';
  });

  it('requires a fresh heartbeat and reports execution only for an executing worker', async () => {
    const result = await makeController(new Date()).ready();
    expect(result).toMatchObject({ status: 'ok', worker: 'observe_only', executionEnabled: false });
    const monitoring = await makeController(new Date(), false, 'monitor_only').ready();
    expect(monitoring).toMatchObject({ executionEnabled: false });
    const executing = await makeController(new Date(), false, 'execute').ready();
    expect(executing).toMatchObject({ worker: 'execute', executionEnabled: true });
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
