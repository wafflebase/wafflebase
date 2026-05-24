import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaService } from '../database/prisma.service';

function createPrismaMock(impl: () => Promise<unknown>): PrismaService {
  return {
    $queryRaw: jest.fn().mockImplementation(impl),
  } as unknown as PrismaService;
}

describe('HealthController', () => {
  it('reports liveness without touching the database', () => {
    const prisma = createPrismaMock(async () => {
      throw new Error('should not be called');
    });
    const controller = new HealthController(prisma);

    expect(controller.liveness()).toEqual({ status: 'ok' });
    expect((prisma.$queryRaw as jest.Mock)).not.toHaveBeenCalled();
  });

  it('reports readiness ok when the database responds', async () => {
    const prisma = createPrismaMock(async () => [{ ok: 1 }]);
    const controller = new HealthController(prisma);

    await expect(controller.readiness()).resolves.toEqual({
      status: 'ok',
      database: 'reachable',
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('throws 503 when the database is unreachable', async () => {
    const prisma = createPrismaMock(async () => {
      throw new Error('connection refused');
    });
    const controller = new HealthController(prisma);

    await expect(controller.readiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
