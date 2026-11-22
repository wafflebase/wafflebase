import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { AuthenticatedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MemberRemovalImpactController } from './member-removal-impact.controller';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';

function requestFor(userId: number) {
  return { user: { id: String(userId) } } as unknown as AuthenticatedRequest;
}

describe('WebhookController', () => {
  let service: Record<string, jest.Mock>;
  let controller: WebhookController;

  beforeEach(() => {
    service = {
      list: jest.fn(),
      create: jest.fn(),
      get: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      test: jest.fn(),
      revealSecret: jest.fn(),
      rotateSecret: jest.fn(),
      enable: jest.fn(),
      disable: jest.fn(),
      listDeliveries: jest.fn(),
      getDelivery: jest.fn(),
      redeliver: jest.fn(),
      removalImpact: jest.fn(),
    };
    controller = new WebhookController(service as unknown as WebhookService);
  });

  // JWT only: an API key — even a `write`-scoped one — must not be able to
  // register an exfiltration endpoint.
  it('is guarded by the JWT guard alone, on both controllers', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, WebhookController)).toEqual([
      JwtAuthGuard,
    ]);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, MemberRemovalImpactController),
    ).toEqual([JwtAuthGuard]);
  });

  it('answers 204 to a delete', async () => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        // eslint-disable-next-line @typescript-eslint/unbound-method -- metadata lookup, never called
        WebhookController.prototype.remove,
      ),
    ).toBe(204);
    await expect(
      controller.remove('ws-1', 'wh-1', requestFor(1)),
    ).resolves.toBeUndefined();
    expect(service.remove).toHaveBeenCalledWith('ws-1', 1, 'wh-1');
  });

  it('passes the caller id as a number', async () => {
    await controller.list('ws-1', requestFor(5));
    expect(service.list).toHaveBeenCalledWith('ws-1', 5);
  });

  it('forwards optional bodies', async () => {
    await controller.rotateSecret('ws-1', 'wh-1', requestFor(1), {
      overlapHours: 3,
    });
    expect(service.rotateSecret).toHaveBeenCalledWith('ws-1', 1, 'wh-1', 3);

    await controller.enable('ws-1', 'wh-1', requestFor(1), {
      recoverSince: '2026-11-20T00:00:00Z',
    });
    expect(service.enable).toHaveBeenCalledWith(
      'ws-1',
      1,
      'wh-1',
      '2026-11-20T00:00:00Z',
    );
  });

  it('routes deliveries and redeliver', async () => {
    await controller.listDeliveries('ws-1', 'wh-1', requestFor(1), {
      status: 'failed',
    });
    expect(service.listDeliveries).toHaveBeenCalledWith('ws-1', 1, 'wh-1', {
      status: 'failed',
    });
    await controller.redeliver('ws-1', 'wh-1', 'd-1', requestFor(1));
    expect(service.redeliver).toHaveBeenCalledWith('ws-1', 1, 'wh-1', 'd-1');
  });

  it('serves removal impact from the members path', async () => {
    const impact = new MemberRemovalImpactController(
      service as unknown as WebhookService,
    );
    await impact.removalImpact('ws-1', 3, requestFor(1));
    expect(service.removalImpact).toHaveBeenCalledWith('ws-1', 1, 3);
  });
});
