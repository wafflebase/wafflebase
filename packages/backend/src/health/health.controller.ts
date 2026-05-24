import {
  Controller,
  Get,
  HttpCode,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../database/prisma.service';

@Controller('health')
@SkipThrottle()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @HttpCode(200)
  liveness() {
    return { status: 'ok' };
  }

  @Get('ready')
  async readiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      // Log the full reason for operators; only surface a coarse
      // status to unauthenticated callers so we don't leak DB host /
      // table names via the probe response body.
      this.logger.error('readiness probe failed: database unreachable', err);
      throw new ServiceUnavailableException({
        status: 'unhealthy',
        database: 'unreachable',
      });
    }
    return { status: 'ok', database: 'reachable' };
  }
}
