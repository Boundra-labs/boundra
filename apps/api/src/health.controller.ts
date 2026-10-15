import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DatabaseService } from './database.service';
import { readConfig } from './config';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get('live')
  @ApiOperation({ summary: 'Process liveness; does not claim chain readiness' })
  live() {
    return { status: 'ok', service: 'api' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Checks PostgreSQL schema and worker heartbeat' })
  async ready() {
    try {
      await this.database.client.$queryRaw`SELECT 1`;
      const heartbeat = await this.database.client.workerHeartbeat.findFirst({
        orderBy: { updatedAt: 'desc' },
      });
      if (
        !heartbeat ||
        Date.now() - heartbeat.updatedAt.getTime() > readConfig().WORKER_HEARTBEAT_MAX_AGE_MS
      ) {
        throw new Error('Worker unavailable');
      }
      return {
        status: 'ok',
        database: 'connected',
        worker: 'observe_only',
        executionEnabled: false,
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'degraded',
        message: 'Database or worker not ready',
      });
    }
  }
}
