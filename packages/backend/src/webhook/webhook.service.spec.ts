import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { SafeOutboundError, assertSafeUrl } from '../common/safe-outbound';
import { loadWebhookConfig, type WebhookConfig } from './webhook-config';
import { WebhookDeliveryWorker } from './webhook-delivery.worker';
import { decryptSecret, encryptSecret } from './webhook-secret';
import { WebhookService } from './webhook.service';

jest.mock('../common/safe-outbound', () => {
  const actual = jest.requireActual<typeof import('../common/safe-outbound')>(
    '../common/safe-outbound',
  );
  return { ...actual, assertSafeUrl: jest.fn() };
});

let mockSecretCounter = 0;
jest.mock('./webhook-signer', () => ({
  generateWebhookSecret: jest.fn(() => `whsec_test${++mockSecretCounter}`),
}));

const OWNER = 1;
const MEMBER = 2;
const OUTSIDER = 99;
const WS = 'ws-1';

const TEST_OK = {
  ok: true,
  status: 200,
  durationMs: 12,
  error: null,
  errorCode: null,
  responseExcerpt: 'ok',
};

function webhookRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wh-1',
    workspaceId: WS,
    createdBy: OWNER,
    creator: { id: OWNER, username: 'owner' },
    name: 'Feed',
    url: 'https://hooks.example.com/secret-path',
    format: 'standard',
    events: [],
    documentTypes: [],
    folderIds: [],
    secretEnc: encryptSecret('whsec_current'),
    prevSecretEnc: null,
    prevSecretExpiresAt: null,
    status: 'active',
    disabledAt: null,
    disabledReason: null,
    failingSince: null,
    warnedAt: null,
    lastDeliveryAt: null,
    lastDeliveryStatus: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    ...overrides,
  };
}

function deliveryRow(id: string, createdAt: string, status = 'failed') {
  return {
    id,
    webhookId: 'wh-1',
    eventType: 'document.created',
    payload: { type: 'document.created' },
    status,
    attempts: 8,
    nextAttemptAt: new Date(createdAt),
    leaseUntil: null,
    lastStatus: 500,
    lastError: null,
    lastDurationMs: 30,
    responseExcerpt: 'boom',
    deliveredAt: null,
    createdAt: new Date(createdAt),
  };
}

type Row = ReturnType<typeof webhookRow>;
type DeliveryRow = ReturnType<typeof deliveryRow>;

interface DeliveryQuery {
  where: { webhookId: string; status?: string; OR?: unknown[] };
  take: number;
}

type Where = { where: Record<string, unknown> };

interface WriteArgs {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
}

/** The Prisma surface the service touches, reading and writing `state`. */
function createMockPrisma(state: { webhook: Row }) {
  const prisma = {
    webhook: {
      findMany: jest.fn(() => Promise.resolve([state.webhook])),
      findFirst: jest.fn(
        (args: { where: { id: string; workspaceId: string } }) =>
          Promise.resolve(
            args.where.id === state.webhook.id &&
              args.where.workspaceId === state.webhook.workspaceId
              ? state.webhook
              : null,
          ),
      ),
      findUniqueOrThrow: jest.fn(() => Promise.resolve(state.webhook)),
      count: jest.fn<Promise<number>, [Where]>(() => Promise.resolve(0)),
      create: jest.fn((args: { data: Partial<Row> }) => {
        state.webhook = webhookRow({ ...args.data, id: 'wh-new' });
        return Promise.resolve(state.webhook);
      }),
      update: jest.fn((args: { data: Partial<Row> }) => {
        state.webhook = { ...state.webhook, ...args.data };
        return Promise.resolve(state.webhook);
      }),
      updateMany: jest.fn<Promise<{ count: number }>, [WriteArgs]>(() =>
        Promise.resolve({ count: 1 }),
      ),
      delete: jest.fn(() => Promise.resolve(state.webhook)),
    },
    webhookDelivery: {
      findMany: jest.fn<Promise<DeliveryRow[]>, [DeliveryQuery]>(() =>
        Promise.resolve([]),
      ),
      findFirst: jest.fn<Promise<DeliveryRow | null>, [Where]>(() =>
        Promise.resolve(null),
      ),
      updateMany: jest.fn<Promise<{ count: number }>, [WriteArgs]>(() =>
        Promise.resolve({ count: 0 }),
      ),
    },
    folder: {
      count: jest.fn<Promise<number>, [Where]>(() => Promise.resolve(0)),
    },
    workspaceMember: {
      findUnique: jest.fn(() =>
        Promise.resolve({ userId: 3 } as { userId: number } | null),
      ),
    },
    user: {
      findMany: jest.fn(() => Promise.resolve([] as { id: number }[])),
      findUnique: jest.fn((args: { where: { id: number } }) =>
        Promise.resolve({
          id: args.where.id,
          username: `user-${args.where.id}`,
        }),
      ),
    },
    chatChannel: {
      count: jest.fn<Promise<number>, [Where]>(() => Promise.resolve(2)),
    },
    $executeRaw: jest.fn(() => Promise.resolve(1)),
    $transaction: jest.fn(
      (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(prisma),
    ),
  };
  return prisma;
}

describe('WebhookService', () => {
  const savedEnv = { ...process.env };
  let prisma: ReturnType<typeof createMockPrisma>;
  let workspaceService: Record<string, jest.Mock>;
  let worker: { sendTest: jest.Mock; deliverNow: jest.Mock };
  let config: WebhookConfig;
  let service: WebhookService;
  const state = {} as { webhook: Row };

  /** Replace the stored webhook row. */
  function store(overrides: Record<string, unknown> = {}) {
    state.webhook = webhookRow(overrides);
  }

  beforeAll(() => {
    process.env.WAFFLEBASE_SECRETS_ENCRYPTION_KEY = 'c'.repeat(64);
  });
  afterAll(() => {
    process.env = savedEnv;
  });

  beforeEach(() => {
    store();
    jest
      .mocked(assertSafeUrl)
      .mockReset()
      .mockResolvedValue({
        addresses: ['93.184.216.34'],
      });
    prisma = createMockPrisma(state);
    const roleOf = (userId: number) =>
      userId === OWNER ? 'owner' : userId === MEMBER ? 'member' : null;
    workspaceService = {
      resolveId: jest.fn((id: string) =>
        id === WS || id === 'ws-slug'
          ? Promise.resolve(WS)
          : Promise.reject(new NotFoundException('Workspace not found')),
      ),
      assertMember: jest.fn((_ws: string, userId: number) => {
        const role = roleOf(userId);
        return role
          ? Promise.resolve({ role })
          : Promise.reject(new ForbiddenException('Not a member'));
      }),
      assertOwner: jest.fn((_ws: string, userId: number) =>
        roleOf(userId) === 'owner'
          ? Promise.resolve({ role: 'owner' })
          : Promise.reject(new ForbiddenException('Owner')),
      ),
    };
    worker = {
      sendTest: jest.fn(() => Promise.resolve(TEST_OK)),
      deliverNow: jest.fn(() => Promise.resolve()),
    };
    config = { ...loadWebhookConfig({}), enabled: true };
    service = new WebhookService(
      prisma as unknown as PrismaService,
      workspaceService as unknown as WorkspaceService,
      worker as unknown as WebhookDeliveryWorker,
      config,
    );
  });

  const createBody = {
    name: 'Feed',
    url: 'https://hooks.example.com/x',
    events: ['document.created'],
    documentTypes: [],
    folderIds: [],
  };

  describe('list', () => {
    it('shows an owner the full URL', async () => {
      const res = await service.list('ws-slug', OWNER);
      expect(res).toMatchObject({ enabled: true, canManage: true });
      expect(res.webhooks[0].url).toBe(state.webhook.url);
      expect(res.webhooks[0].host).toBe('hooks.example.com');
    });

    it('shows a member the host only', async () => {
      const res = await service.list(WS, MEMBER);
      expect(res.canManage).toBe(false);
      expect(res.webhooks[0]).not.toHaveProperty('url');
      expect(res.webhooks[0].host).toBe('hooks.example.com');
    });

    it('refuses a non-member', async () => {
      await expect(service.list(WS, OUTSIDER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('answers enabled:false with the feature off', async () => {
      config.enabled = false;
      const res = await service.list(WS, OWNER);
      expect(res.enabled).toBe(false);
    });
  });

  describe('feature off', () => {
    beforeEach(() => {
      config.enabled = false;
    });

    it('answers 404 to every management route', async () => {
      await expect(service.get(WS, OWNER, 'wh-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        service.create(WS, OWNER, createBody),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.remove(WS, OWNER, 'wh-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.webhook.create).not.toHaveBeenCalled();
      expect(prisma.webhook.delete).not.toHaveBeenCalled();
    });
  });

  describe('ownership', () => {
    it('refuses a member', async () => {
      await expect(service.get(WS, MEMBER, 'wh-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("answers 404 for another workspace's webhook", async () => {
      store({ workspaceId: 'ws-other' });
      await expect(service.get(WS, OWNER, 'wh-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        service.revealSecret(WS, OWNER, 'wh-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('stores an encrypted secret, records the creator and runs a test', async () => {
      const res = await service.create(WS, OWNER, createBody);

      const data = prisma.webhook.create.mock.calls[0][0].data;
      expect(data.createdBy).toBe(OWNER);
      expect(data.secretEnc).not.toContain('whsec_');
      expect(decryptSecret(String(data.secretEnc))).toMatch(/^whsec_test/);
      expect(worker.sendTest).toHaveBeenCalledWith('wh-new', {
        id: OWNER,
        username: `user-${OWNER}`,
      });
      expect(res.test).toEqual(TEST_OK);
      expect(res.webhook.id).toBe('wh-new');
      expect(JSON.stringify(res)).not.toContain('whsec_');
    });

    it('answers 503 naming the key when no secrets key is set', async () => {
      const saved = process.env.WAFFLEBASE_SECRETS_ENCRYPTION_KEY;
      const savedDs = process.env.DATASOURCE_ENCRYPTION_KEY;
      delete process.env.WAFFLEBASE_SECRETS_ENCRYPTION_KEY;
      delete process.env.DATASOURCE_ENCRYPTION_KEY;
      try {
        await expect(service.create(WS, OWNER, createBody)).rejects.toThrow(
          /WAFFLEBASE_SECRETS_ENCRYPTION_KEY/,
        );
        expect(prisma.webhook.create).not.toHaveBeenCalled();
      } finally {
        process.env.WAFFLEBASE_SECRETS_ENCRYPTION_KEY = saved;
        if (savedDs !== undefined)
          process.env.DATASOURCE_ENCRYPTION_KEY = savedDs;
      }
    });

    it('saves even when the test fails, and when the worker throws', async () => {
      worker.sendTest.mockRejectedValueOnce(new Error('kaput'));
      const res = await service.create(WS, OWNER, createBody);
      expect(res.test.ok).toBe(false);
      expect(prisma.webhook.create).toHaveBeenCalled();
    });

    it('maps an SSRF refusal to a coded 400', async () => {
      jest
        .mocked(assertSafeUrl)
        .mockRejectedValue(
          new SafeOutboundError('private_address', 'Private', '10.0.0.5'),
        );
      const error = await service
        .create(WS, OWNER, createBody)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        code: 'private_address',
        message: 'Private',
        address: '10.0.0.5',
      });
      expect(prisma.webhook.create).not.toHaveBeenCalled();
    });

    it('checks the URL with the configured overrides', async () => {
      config.allowedCidrs = ['10.0.4.0/24'];
      config.allowHttp = true;
      await service.create(WS, OWNER, createBody);
      expect(assertSafeUrl).toHaveBeenCalledWith(createBody.url, {
        allowedCidrs: ['10.0.4.0/24'],
        allowHttp: true,
      });
    });

    it('refuses an eleventh webhook with 409', async () => {
      prisma.webhook.count.mockResolvedValue(10);
      await expect(
        service.create(WS, OWNER, createBody),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.webhook.create).not.toHaveBeenCalled();
    });

    it("refuses a folder that is not this workspace's", async () => {
      prisma.folder.count.mockResolvedValue(1);
      await expect(
        service.create(WS, OWNER, {
          ...createBody,
          folderIds: [
            '00000000-0000-4000-8000-000000000001',
            '00000000-0000-4000-8000-000000000002',
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.folder.count).toHaveBeenCalledWith({
        where: {
          id: {
            in: [
              '00000000-0000-4000-8000-000000000001',
              '00000000-0000-4000-8000-000000000002',
            ],
          },
          workspaceId: WS,
        },
      });
    });
  });

  describe('update', () => {
    it('re-tests only when the URL changes', async () => {
      const renamed = await service.update(WS, OWNER, 'wh-1', {
        name: 'Renamed',
      });
      expect(renamed.test).toBeNull();
      expect(assertSafeUrl).not.toHaveBeenCalled();

      const moved = await service.update(WS, OWNER, 'wh-1', {
        url: 'https://other.example.com/y',
      });
      expect(assertSafeUrl).toHaveBeenCalledTimes(1);
      expect(moved.test).toEqual(TEST_OK);
      expect(moved.webhook.url).toBe('https://other.example.com/y');
    });

    it('treats the same URL as unchanged', async () => {
      const res = await service.update(WS, OWNER, 'wh-1', {
        url: state.webhook.url,
      });
      expect(res.test).toBeNull();
      expect(prisma.webhook.update).not.toHaveBeenCalled();
    });
  });

  describe('secrets', () => {
    it('reveals the current secret, and the previous one only in overlap', async () => {
      expect(await service.revealSecret(WS, OWNER, 'wh-1')).toEqual({
        secret: 'whsec_current',
        previousSecret: null,
        previousExpiresAt: null,
      });

      const expires = new Date(Date.now() + 60_000);
      store({
        prevSecretEnc: encryptSecret('whsec_old'),
        prevSecretExpiresAt: expires,
      });
      expect(await service.revealSecret(WS, OWNER, 'wh-1')).toEqual({
        secret: 'whsec_current',
        previousSecret: 'whsec_old',
        previousExpiresAt: expires.toISOString(),
      });
    });

    it('rotates, keeping the old secret for the overlap', async () => {
      const before = Date.now();
      const res = await service.rotateSecret(WS, OWNER, 'wh-1', 2);
      const call = prisma.webhook.updateMany.mock.calls[0][0];
      expect(call.data.prevSecretEnc).toBe(state.webhook.secretEnc);
      expect(decryptSecret(String(call.data.secretEnc))).toBe(res.secret);
      const expiresAt = new Date(res.previousExpiresAt).getTime();
      expect(expiresAt - before).toBeGreaterThanOrEqual(2 * 3600_000 - 1000);
      expect(expiresAt - before).toBeLessThanOrEqual(2 * 3600_000 + 1000);
    });

    it('refuses a second rotation during the overlap', async () => {
      prisma.webhook.updateMany.mockResolvedValue({ count: 0 });
      const error = await service
        .rotateSecret(WS, OWNER, 'wh-1')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'rotation_in_progress',
      });
    });
  });

  describe('enable / disable', () => {
    it('disables with reason manual', async () => {
      const res = await service.disable(WS, OWNER, 'wh-1');
      expect(res.status).toBe('disabled');
      expect(res.disabledReason).toBe('manual');
      // Queued rows end with it, so re-enabling never flushes them unasked,
      // and the oldest of them becomes the default "recover since".
      expect(prisma.webhookDelivery.updateMany).toHaveBeenCalledWith({
        where: { webhookId: { in: ['wh-1'] }, status: 'pending' },
        data: { status: 'failed', lastError: 'Webhook turned off' },
      });
      const sql = (prisma.$executeRaw.mock.calls as unknown[][]).map((c) =>
        (c[0] as string[]).join('?'),
      );
      expect(sql.some((q) => q.includes('"recoverFrom"'))).toBe(true);
    });

    it('keeps an earlier reason when already disabled', async () => {
      store({ status: 'disabled', disabledReason: 'gone' });
      const res = await service.disable(WS, OWNER, 'wh-1');
      expect(res.disabledReason).toBe('gone');
      expect(prisma.webhook.update).not.toHaveBeenCalled();
    });

    it('re-enables, takes over createdBy and re-queues failed deliveries since', async () => {
      store({
        status: 'disabled',
        disabledReason: 'creator_removed',
        createdBy: 7,
        failingSince: new Date(),
      });
      const since = '2026-11-20T00:00:00.000Z';
      const res = await service.enable(WS, OWNER, 'wh-1', since);

      expect(prisma.webhook.update.mock.calls[0][0].data).toMatchObject({
        status: 'active',
        disabledReason: null,
        recoverFrom: null,
        failingSince: null,
        createdBy: OWNER,
      });
      // A test is a one-shot check of the endpoint, never recovered.
      const requeue = prisma.webhookDelivery.updateMany.mock.calls[0][0];
      expect(requeue.where).toEqual({
        webhookId: 'wh-1',
        status: 'failed',
        eventType: { not: 'webhook.test' },
        createdAt: { gte: new Date(since) },
      });
      expect(requeue.data).toMatchObject({ status: 'pending', attempts: 0 });
      expect(prisma.$executeRaw).toHaveBeenCalled();
      expect(res.status).toBe('active');
    });

    it('re-queues nothing without recoverSince', async () => {
      await service.enable(WS, OWNER, 'wh-1', null);
      expect(prisma.webhookDelivery.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('deliveries', () => {
    it('pages on (createdAt, id) and returns the next cursor', async () => {
      prisma.webhookDelivery.findMany.mockResolvedValue([
        deliveryRow('d3', '2026-11-20T00:00:03Z'),
        deliveryRow('d2', '2026-11-20T00:00:02Z'),
        deliveryRow('d1', '2026-11-20T00:00:01Z'),
      ]);
      const page = await service.listDeliveries(WS, OWNER, 'wh-1', {
        status: 'failed',
        before: '2026-11-21T00:00:00.000Z',
        beforeId: 'd9',
        limit: 2,
      });

      const query = prisma.webhookDelivery.findMany.mock.calls[0][0];
      expect(query.take).toBe(3);
      expect(query.where.status).toBe('failed');
      expect(query.where.OR).toEqual([
        { createdAt: { lt: new Date('2026-11-21T00:00:00.000Z') } },
        {
          createdAt: new Date('2026-11-21T00:00:00.000Z'),
          id: { lt: 'd9' },
        },
      ]);
      expect(page.deliveries.map((d) => d.id)).toEqual(['d3', 'd2']);
      expect(page.nextCursor).toEqual({
        before: '2026-11-20T00:00:02.000Z',
        beforeId: 'd2',
      });
    });

    it('returns no cursor on the last page', async () => {
      prisma.webhookDelivery.findMany.mockResolvedValue([
        deliveryRow('d1', '2026-11-20T00:00:01Z'),
      ]);
      const page = await service.listDeliveries(WS, OWNER, 'wh-1', {});
      expect(page.nextCursor).toBeNull();
    });

    it('refuses beforeId without before', async () => {
      await expect(
        service.listDeliveries(WS, OWNER, 'wh-1', { beforeId: 'd1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('answers 404 for a delivery of another webhook', async () => {
      await expect(
        service.getDelivery(WS, OWNER, 'wh-1', 'd-x'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.webhookDelivery.findFirst).toHaveBeenCalledWith({
        where: { id: 'd-x', webhookId: 'wh-1' },
      });
    });

    it('redelivers through the worker under the same id', async () => {
      prisma.webhookDelivery.findFirst.mockResolvedValue(
        deliveryRow('d1', '2026-11-20T00:00:01Z'),
      );
      const res = await service.redeliver(WS, OWNER, 'wh-1', 'd1');
      expect(worker.deliverNow).toHaveBeenCalledWith('d1');
      expect(res.id).toBe('d1');
    });

    it('refuses to redeliver on a disabled webhook', async () => {
      store({ status: 'disabled', disabledReason: 'manual' });
      prisma.webhookDelivery.findFirst.mockResolvedValue(
        deliveryRow('d1', '2026-11-20T00:00:01Z'),
      );
      await expect(
        service.redeliver(WS, OWNER, 'wh-1', 'd1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(worker.deliverNow).not.toHaveBeenCalled();
    });
  });

  describe('removalImpact', () => {
    it('counts sole-member private channels and active webhooks', async () => {
      prisma.webhook.count.mockResolvedValue(1);
      expect(await service.removalImpact(WS, OWNER, 3)).toEqual({
        privateChannelsDeleted: 2,
        webhooksDisabled: 1,
        botsRemoved: 0,
      });
      expect(prisma.chatChannel.count).toHaveBeenCalledWith({
        where: {
          workspaceId: WS,
          kind: 'private',
          members: { some: { userId: 3 }, every: { userId: { in: [3] } } },
        },
      });
    });

    // Their bots leave with them (WorkspaceService.removeMember), so a
    // private channel holding only them and their bots empties too.
    it('counts the bots they own and the channels only they and those bots share', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 50 }, { id: 51 }]);
      expect(await service.removalImpact(WS, OWNER, 3)).toMatchObject({
        botsRemoved: 2,
      });
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          kind: 'bot',
          botOwnerId: 3,
          botWorkspaceId: WS,
          workspaceMembers: { some: { workspaceId: WS } },
        },
        select: { id: true },
      });
      expect(prisma.chatChannel.count).toHaveBeenCalledWith({
        where: {
          workspaceId: WS,
          kind: 'private',
          members: {
            some: { userId: 3 },
            every: { userId: { in: [3, 50, 51] } },
          },
        },
      });
      expect(prisma.webhook.count).toHaveBeenCalledWith({
        where: { workspaceId: WS, createdBy: 3, status: 'active' },
      });
    });

    it('lets a member ask about themself, not about others', async () => {
      await expect(
        service.removalImpact(WS, MEMBER, MEMBER),
      ).resolves.toBeDefined();
      await expect(service.removalImpact(WS, MEMBER, 3)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('answers 404 for somebody who is not a member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);
      await expect(service.removalImpact(WS, OWNER, 3)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
