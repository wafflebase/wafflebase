import type { Webhook } from '@prisma/client';
import type { PgBus } from '../common/pg-bus';
import { SafeOutboundError, safeFetch } from '../common/safe-outbound';
import type { PrismaService } from '../database/prisma.service';
import type { NotificationService } from '../notification/notification.service';
import { loadWebhookConfig, type WebhookConfig } from './webhook-config';
import {
  apiWritersOf,
  signingSecrets,
  WebhookDeliveryWorker,
} from './webhook-delivery.worker';
import type { WebhookEventService } from './webhook-event.service';
import { signWebhook } from './webhook-signer';

jest.mock('../common/safe-outbound', () => {
  const actual = jest.requireActual<typeof import('../common/safe-outbound')>(
    '../common/safe-outbound',
  );
  return { ...actual, safeFetch: jest.fn() };
});
jest.mock('./webhook-signer', () => ({
  signWebhook: jest.fn((input: { id: string; timestamp: number }) => ({
    'webhook-id': input.id,
    'webhook-timestamp': String(input.timestamp),
    'webhook-signature': 'v1,sig',
  })),
}));
jest.mock('./webhook-secret', () => ({
  decryptSecret: jest.fn((enc: string) => `plain:${enc}`),
  secretsKeyProblem: jest.fn(() => null),
}));

const fetchMock = safeFetch as jest.MockedFunction<typeof safeFetch>;
const signMock = signWebhook as jest.MockedFunction<typeof signWebhook>;

const NOW = new Date('2026-11-22T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function webhook(overrides: Partial<Webhook> = {}): Webhook {
  return {
    id: 'wh1',
    workspaceId: 'ws1',
    createdBy: 1,
    name: 'Zapier',
    url: 'https://hooks.example.com/in',
    format: 'standard',
    events: [],
    documentTypes: [],
    folderIds: [],
    secretEnc: 'enc-current',
    prevSecretEnc: null,
    prevSecretExpiresAt: null,
    status: 'active',
    disabledAt: null,
    disabledReason: null,
    recoverFrom: null,
    failingSince: null,
    warnedAt: null,
    lastDeliveryAt: null,
    lastDeliveryStatus: null,
    createdAt: ago(10 * 24 * HOUR),
    updatedAt: ago(HOUR),
    ...overrides,
  };
}

/**
 * Whether a row satisfies a Prisma `where` as far as these tests write them:
 * equality, `{ not: null }`, `{ lt }` and `{ in }`.
 */
function matchesWhere(
  row: Record<string, unknown>,
  where: Record<string, unknown>,
): boolean {
  return Object.entries(where).every(([k, v]) => {
    const value = row[k];
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const op = v as { not?: unknown; lt?: Date; in?: unknown[] };
      if ('not' in op) return value !== op.not;
      if (op.lt) return value instanceof Date && value < op.lt;
      if (op.in) return op.in.includes(value);
    }
    return value === v;
  });
}

/** A tagged-template call's SQL, for routing `$queryRaw`. */
function sqlOf(args: unknown[]): string {
  const first = args[0] as TemplateStringsArray | { strings?: string[] };
  if (Array.isArray(first)) return first.join('?');
  return '';
}

interface Harness {
  worker: WebhookDeliveryWorker;
  prisma: ReturnType<typeof makePrisma>;
  events: { emitDocumentEvent: jest.Mock };
  notifications: { createWebhookAlert: jest.Mock };
  bus: { listen: jest.Mock };
}

function makePrisma() {
  const state = {
    claimed: [] as unknown[],
    pendingRemoved: [] as unknown[],
    capped: [] as unknown[],
    webhooks: [] as Webhook[],
  };
  const prisma = {
    state,
    $executeRaw: jest.fn(() => Promise.resolve(0)),
    $queryRaw: jest.fn((...args: unknown[]) => {
      const sql = sqlOf(args);
      if (sql.includes('UPDATE "WebhookDelivery"')) {
        const rows = state.claimed;
        state.claimed = [];
        return Promise.resolve(rows);
      }
      if (sql.includes('DELETE FROM "WebhookContentPending"')) {
        const rows = state.pendingRemoved;
        state.pendingRemoved = [];
        return Promise.resolve(rows);
      }
      if (sql.includes('GROUP BY')) return Promise.resolve(state.capped);
      return Promise.resolve([]);
    }),
    $transaction: jest.fn(
      (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(prisma),
    ),
    webhook: {
      findMany: jest.fn(() => Promise.resolve(state.webhooks)),
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(state.webhooks.find((w) => w.id === where.id) ?? null),
      ),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Partial<Webhook>;
        }) => {
          let count = 0;
          state.webhooks = state.webhooks.map((w) => {
            if (!matchesWhere(w as unknown as Record<string, unknown>, where)) {
              return w;
            }
            count += 1;
            return { ...w, ...data };
          });
          return Promise.resolve({ count });
        },
      ),
    },
    webhookDelivery: {
      updateMany: jest.fn((_args: { where: Record<string, unknown> }) =>
        Promise.resolve({ count: 1 }),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'test-delivery', ...data }),
      ),
      deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
    },
    webhookContentPending: {
      findMany: jest.fn(() => Promise.resolve([])),
    },
    document: {
      findFirst: jest.fn(() => Promise.resolve(null)),
    },
  };
  return prisma;
}

function harness(config: Partial<WebhookConfig> = {}): Harness {
  const prisma = makePrisma();
  const events = { emitDocumentEvent: jest.fn(() => Promise.resolve()) };
  const notifications = {
    createWebhookAlert: jest.fn(() => Promise.resolve({ created: 1 })),
  };
  const bus = {
    listen: jest.fn(() => Promise.resolve(() => Promise.resolve())),
  };
  const worker = new WebhookDeliveryWorker(
    prisma as unknown as PrismaService,
    events as unknown as WebhookEventService,
    notifications as unknown as NotificationService,
    {
      ...loadWebhookConfig({ WAFFLEBASE_WEBHOOKS_ENABLED: 'true' }),
      ...config,
    },
    bus as unknown as PgBus,
  );
  worker.now = () => NOW;
  worker.random = () => 0.5; // no jitter
  return { worker, prisma, events, notifications, bus };
}

function claim(
  h: Harness,
  attempts = 1,
  hook: Webhook = webhook(),
  eventType = 'document.created',
) {
  h.prisma.state.webhooks = [hook];
  h.prisma.state.claimed = [
    {
      id: 'd1',
      webhookId: hook.id,
      eventType,
      payload: {
        type: eventType,
        timestamp: NOW.toISOString(),
        data: {},
      },
      attempts,
    },
  ];
}

async function tick(h: Harness): Promise<void> {
  await h.worker.runOnce();
  await h.worker.drain();
}

function respond(status: number, headers: Record<string, string> = {}) {
  fetchMock.mockResolvedValueOnce({
    status,
    headers,
    bodyExcerpt: 'ok',
    durationMs: 42,
  });
}

/** The data of the update that finished delivery `d1`. */
function deliveryUpdate(h: Harness): Record<string, unknown> {
  const call = h.prisma.webhookDelivery.updateMany.mock.calls.find(
    (c: unknown[]) => (c[0] as { where: { id?: string } }).where.id === 'd1',
  ) as unknown[] | undefined;
  return (call?.[0] as { data: Record<string, unknown> }).data;
}

beforeEach(() => {
  fetchMock.mockReset();
  signMock.mockClear();
});

describe('WebhookDeliveryWorker lifecycle', () => {
  it('starts nothing when the feature is off', async () => {
    const h = harness({ enabled: false });
    await h.worker.onModuleInit();
    expect(h.bus.listen).not.toHaveBeenCalled();
    await h.worker.onModuleDestroy();
  });

  it('listens on the webhook channel when on', async () => {
    const h = harness();
    await h.worker.onModuleInit();
    expect(h.bus.listen).toHaveBeenCalledWith(
      'webhook',
      expect.objectContaining({
        onNotify: expect.any(Function) as unknown,
      }),
    );
    await h.worker.onModuleDestroy();
  });
});

describe('WebhookDeliveryWorker sending', () => {
  it('records a 2xx as delivered and ends the failure streak', async () => {
    const h = harness();
    claim(h, 1, webhook({ failingSince: ago(HOUR), warnedAt: ago(HOUR) }));
    respond(204);
    await tick(h);

    expect(deliveryUpdate(h)).toMatchObject({
      status: 'delivered',
      deliveredAt: NOW,
      lastStatus: 204,
      lastDurationMs: 42,
      leaseUntil: null,
    });
    expect(h.prisma.state.webhooks[0]).toMatchObject({
      lastDeliveryAt: NOW,
      lastDeliveryStatus: 204,
      failingSince: null,
      warnedAt: null,
    });
  });

  it('signs with the delivery id and sends the event headers', async () => {
    const h = harness();
    claim(h);
    respond(200);
    await tick(h);

    expect(signMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'd1',
        timestamp: Math.floor(NOW.getTime() / 1000),
        secrets: ['plain:enc-current'],
      }),
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hooks.example.com/in');
    expect(init.headers).toMatchObject({
      'webhook-id': 'd1',
      'content-type': 'application/json',
      'x-wafflebase-event': 'document.created',
    });
    expect(init.headers['user-agent']).toMatch(/^Wafflebase-Webhooks\/\d/);
    expect(init).toMatchObject({ timeoutMs: 10_000, maxResponseBytes: 1024 });
  });

  it('retries a 5xx on the schedule', async () => {
    const h = harness();
    claim(h, 1);
    respond(503);
    await tick(h);
    expect(deliveryUpdate(h)).toMatchObject({
      status: 'pending',
      nextAttemptAt: new Date(NOW.getTime() + 5_000),
      lastStatus: 503,
      lastError: 'HTTP 503',
    });
    expect(h.prisma.state.webhooks[0].failingSince).toEqual(NOW);
  });

  it('treats a 3xx as a failure and does not follow it', async () => {
    const h = harness();
    claim(h, 2);
    respond(302, { location: 'https://elsewhere.example' });
    await tick(h);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(deliveryUpdate(h)).toMatchObject({
      status: 'pending',
      nextAttemptAt: new Date(NOW.getTime() + 300_000),
      lastError: 'HTTP 302: redirects are not followed',
    });
  });

  it('fails the row after the eighth attempt', async () => {
    const h = harness();
    claim(h, 8);
    respond(500);
    await tick(h);
    expect(deliveryUpdate(h)).toMatchObject({ status: 'failed' });
  });

  it('honours Retry-After on a 429', async () => {
    const h = harness();
    claim(h, 1);
    respond(429, { 'Retry-After': '120' });
    await tick(h);
    expect(deliveryUpdate(h)).toMatchObject({
      status: 'pending',
      nextAttemptAt: new Date(NOW.getTime() + 120_000),
      lastStatus: 429,
    });
  });

  it('disables the webhook on a 410 and tells every owner', async () => {
    const h = harness();
    claim(h, 1);
    respond(410);
    await tick(h);

    expect(deliveryUpdate(h)).toMatchObject({ status: 'failed' });
    expect(h.prisma.state.webhooks[0]).toMatchObject({
      status: 'disabled',
      disabledReason: 'gone',
      disabledAt: NOW,
    });
    // What it still had queued fails with it, and becomes the default
    // "recover since".
    expect(h.prisma.webhookDelivery.updateMany).toHaveBeenCalledWith({
      where: { webhookId: { in: ['wh1'] }, status: 'pending' },
      data: { status: 'failed', lastError: 'Webhook turned off' },
    });
    expect(
      h.prisma.$executeRaw.mock.calls.some((c: unknown[]) =>
        sqlOf(c).includes('"recoverFrom"'),
      ),
    ).toBe(true);
    expect(h.notifications.createWebhookAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'webhook_disabled',
        workspaceId: 'ws1',
        webhook: { id: 'wh1', name: 'Zapier' },
      }),
    );
  });

  it('counts an SSRF refusal as a failed attempt', async () => {
    const h = harness();
    claim(h, 1);
    fetchMock.mockRejectedValueOnce(
      new SafeOutboundError(
        'private_address',
        'This address resolves to a private network (10.0.4.12)',
        '10.0.4.12',
      ),
    );
    await tick(h);
    expect(deliveryUpdate(h)).toMatchObject({
      status: 'pending',
      lastStatus: null,
      lastError: 'This address resolves to a private network (10.0.4.12)',
    });
  });

  // Failed like the rest of its queue, so a re-enable that recovers
  // nothing does not send it.
  it('fails a row unspent when its webhook was disabled meanwhile', async () => {
    const h = harness();
    claim(h, 3, webhook({ status: 'disabled', disabledReason: 'manual' }));
    await tick(h);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(deliveryUpdate(h)).toEqual({
      status: 'failed',
      leaseUntil: null,
      lastError: 'Webhook turned off',
      attempts: { decrement: 1 },
    });
  });

  it('fails instead of retrying when the webhook went off during the send', async () => {
    const h = harness();
    claim(h, 1);
    // The retry is conditional on the webhook still being on; it is not.
    h.prisma.webhookDelivery.updateMany.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve({ count: where.webhook ? 0 : 1 }),
    );
    respond(503);
    await tick(h);
    const calls = h.prisma.webhookDelivery.updateMany.mock.calls.map(
      (c: unknown[]) => c[0] as { where: Record<string, unknown>; data: unknown },
    );
    expect(calls).toContainEqual({
      where: { id: 'd1', status: 'in_flight', webhook: { status: 'active' } },
      data: expect.objectContaining({ status: 'pending' }) as unknown,
    });
    expect(calls).toContainEqual({
      where: { id: 'd1', status: 'in_flight' },
      data: expect.objectContaining({
        status: 'failed',
        lastStatus: 503,
        lastError: 'Webhook turned off',
      }) as unknown,
    });
  });

  // A redelivered (or recovered) test is one shot, as `sendTest` is.
  it('sends a queued webhook.test once, outside the failure streak', async () => {
    const h = harness();
    claim(h, 2, webhook(), 'webhook.test');
    respond(503);
    await tick(h);
    expect(deliveryUpdate(h)).toMatchObject({
      status: 'failed',
      lastStatus: 503,
    });
    expect(h.prisma.webhook.updateMany).not.toHaveBeenCalled();
  });

  it('does not disable on a 410 to a queued webhook.test', async () => {
    const h = harness();
    claim(h, 2, webhook(), 'webhook.test');
    respond(410);
    await tick(h);
    expect(deliveryUpdate(h)).toMatchObject({
      status: 'failed',
      lastError: 'HTTP 410 Gone',
    });
    expect(h.prisma.state.webhooks[0].status).toBe('active');
    expect(h.prisma.webhook.updateMany).not.toHaveBeenCalled();
  });
});

describe('WebhookDeliveryWorker failure streak', () => {
  it('warns every owner once two days into a streak', async () => {
    const h = harness();
    claim(h, 1, webhook({ failingSince: ago(49 * HOUR) }));
    respond(500);
    await tick(h);

    expect(h.prisma.state.webhooks[0].warnedAt).toEqual(NOW);
    expect(h.notifications.createWebhookAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'webhook_failing',
        since: ago(49 * HOUR),
      }),
    );

    // The next failure does not warn again.
    h.notifications.createWebhookAlert.mockClear();
    claim(h, 2, h.prisma.state.webhooks[0]);
    respond(500);
    await tick(h);
    expect(h.notifications.createWebhookAlert).not.toHaveBeenCalled();
  });

  it('does not warn in the first two days', async () => {
    const h = harness();
    claim(h, 1, webhook({ failingSince: ago(47 * HOUR) }));
    respond(500);
    await tick(h);
    expect(h.notifications.createWebhookAlert).not.toHaveBeenCalled();
    expect(h.prisma.state.webhooks[0].status).toBe('active');
  });

  // The outage ended, nothing was sent for two days, then one transient
  // error: a new streak, not the old one's last straw.
  it('starts a new streak after a long gap instead of disabling', async () => {
    const h = harness();
    claim(
      h,
      1,
      webhook({
        failingSince: ago(73 * HOUR),
        lastDeliveryAt: ago(45 * HOUR),
      }),
    );
    respond(502);
    await tick(h);
    expect(h.prisma.state.webhooks[0]).toMatchObject({
      status: 'active',
      failingSince: NOW,
      warnedAt: null,
    });
    expect(h.notifications.createWebhookAlert).not.toHaveBeenCalled();
  });

  it('warns rather than disables a three-day streak nobody was warned of', async () => {
    const h = harness();
    claim(
      h,
      1,
      webhook({ failingSince: ago(73 * HOUR), lastDeliveryAt: ago(HOUR) }),
    );
    respond(502);
    await tick(h);
    expect(h.prisma.state.webhooks[0]).toMatchObject({
      status: 'active',
      warnedAt: NOW,
    });
    expect(h.notifications.createWebhookAlert).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'webhook_failing' }),
    );
  });

  it('disables after three days with no success', async () => {
    const h = harness();
    claim(
      h,
      1,
      webhook({ failingSince: ago(73 * HOUR), warnedAt: ago(25 * HOUR) }),
    );
    respond(502);
    await tick(h);

    expect(h.prisma.state.webhooks[0]).toMatchObject({
      status: 'disabled',
      disabledReason: 'failing',
    });
    expect(h.notifications.createWebhookAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'webhook_disabled',
        reason: expect.stringContaining('Last response: 502') as unknown,
        since: ago(73 * HOUR),
      }),
    );
  });
});

describe('signingSecrets', () => {
  const decrypt = (enc: string) => `plain:${enc}`;

  it('signs with the current secret only outside a rotation', () => {
    expect(signingSecrets(webhook(), NOW, decrypt)).toEqual([
      'plain:enc-current',
    ]);
  });

  it('adds the previous secret while the overlap lasts', () => {
    const rotating = webhook({
      prevSecretEnc: 'enc-prev',
      prevSecretExpiresAt: new Date(NOW.getTime() + HOUR),
    });
    expect(signingSecrets(rotating, NOW, decrypt)).toEqual([
      'plain:enc-current',
      'plain:enc-prev',
    ]);
  });

  it('drops the previous secret once it expires', () => {
    const expired = webhook({
      prevSecretEnc: 'enc-prev',
      prevSecretExpiresAt: NOW,
    });
    expect(signingSecrets(expired, NOW, decrypt)).toEqual([
      'plain:enc-current',
    ]);
  });

  it('is what the worker signs with during a rotation', async () => {
    const h = harness();
    claim(
      h,
      1,
      webhook({
        prevSecretEnc: 'enc-prev',
        prevSecretExpiresAt: new Date(NOW.getTime() + HOUR),
      }),
    );
    respond(200);
    await tick(h);
    expect(signMock).toHaveBeenCalledWith(
      expect.objectContaining({
        secrets: ['plain:enc-current', 'plain:enc-prev'],
      }),
    );
  });
});

describe('WebhookDeliveryWorker content flush', () => {
  const document = {
    id: 'doc1',
    type: 'sheet',
    title: 'Q4 plan',
    workspaceId: 'ws1',
    folderId: null,
  };

  it('asks for windows quiet for a minute or open for five', async () => {
    const h = harness();
    await tick(h);
    expect(h.prisma.webhookContentPending.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { lastIssuedAt: { lte: ago(60_000) } },
            { firstSeenAt: { lte: ago(300_000) } },
          ],
        },
      }),
    );
  });

  it('honours tuned windows', async () => {
    const h = harness({ quietMs: 10_000, maxWaitMs: 20_000 });
    await tick(h);
    expect(h.prisma.webhookContentPending.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { lastIssuedAt: { lte: ago(10_000) } },
            { firstSeenAt: { lte: ago(20_000) } },
          ],
        },
      }),
    );
  });

  it('turns a due window into one content_updated', async () => {
    const h = harness();
    h.prisma.webhookContentPending.findMany.mockResolvedValueOnce([
      { documentId: 'doc1' },
    ] as never);
    h.prisma.state.pendingRemoved = [
      {
        documentId: 'doc1',
        firstSeenAt: ago(4 * 60_000),
        lastIssuedAt: ago(70_000),
        apiWriters: [
          { api_key_id: 'k2', user_id: 7, at: '2026-11-22T11:59:00.000Z' },
          { api_key_id: 'k1', user_id: 7, at: '2026-11-22T11:57:00.000Z' },
          { bogus: true },
        ],
      },
    ];
    h.prisma.document.findFirst.mockResolvedValueOnce(document as never);
    await tick(h);

    expect(h.prisma.document.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'doc1', deletedAt: null } }),
    );
    expect(h.events.emitDocumentEvent).toHaveBeenCalledWith(h.prisma, {
      type: 'document.content_updated',
      actor: null,
      document,
      extra: {
        window_start: ago(4 * 60_000).toISOString(),
        updated_at: ago(70_000).toISOString(),
        api_writers: [
          { api_key_id: 'k1', user_id: 7, at: '2026-11-22T11:57:00.000Z' },
          { api_key_id: 'k2', user_id: 7, at: '2026-11-22T11:59:00.000Z' },
        ],
      },
    });
  });

  it('drops the window of a trashed document', async () => {
    const h = harness();
    h.prisma.webhookContentPending.findMany.mockResolvedValueOnce([
      { documentId: 'doc1' },
    ] as never);
    h.prisma.state.pendingRemoved = [
      {
        documentId: 'doc1',
        firstSeenAt: ago(6 * 60_000),
        lastIssuedAt: ago(5_000),
        apiWriters: [],
      },
    ];
    // `deletedAt: null` finds nothing for a trashed document.
    h.prisma.document.findFirst.mockResolvedValueOnce(null);
    await tick(h);
    expect(h.events.emitDocumentEvent).not.toHaveBeenCalled();
  });

  it('emits nothing when another replica flushed it first', async () => {
    const h = harness();
    h.prisma.webhookContentPending.findMany.mockResolvedValueOnce([
      { documentId: 'doc1' },
    ] as never);
    h.prisma.state.pendingRemoved = [];
    await tick(h);
    expect(h.prisma.document.findFirst).not.toHaveBeenCalled();
    expect(h.events.emitDocumentEvent).not.toHaveBeenCalled();
  });
});

describe('apiWritersOf', () => {
  it('keeps only well-formed entries', () => {
    expect(apiWritersOf(null)).toEqual([]);
    expect(apiWritersOf({})).toEqual([]);
    expect(
      apiWritersOf([{ api_key_id: 'k', user_id: '7', at: 'x' }, 'nope']),
    ).toEqual([]);
  });
});

describe('WebhookDeliveryWorker maintenance', () => {
  it('returns expired leases to pending, or fails spent ones, tests and turned-off ones', async () => {
    const h = harness();
    await tick(h);
    const calls = h.prisma.webhookDelivery.updateMany.mock.calls.map(
      (c: unknown[]) => c[0],
    );
    expect(calls).toContainEqual({
      where: {
        status: 'in_flight',
        leaseUntil: { lt: NOW },
        OR: [{ attempts: { gte: 8 } }, { eventType: 'webhook.test' }],
      },
      data: { status: 'failed', leaseUntil: null, lastError: 'Lease expired' },
    });
    expect(calls).toContainEqual({
      where: {
        status: 'in_flight',
        leaseUntil: { lt: NOW },
        webhook: { status: { not: 'active' } },
      },
      data: {
        status: 'failed',
        leaseUntil: null,
        lastError: 'Webhook turned off',
      },
    });
    expect(calls).toContainEqual({
      where: { status: 'in_flight', leaseUntil: { lt: NOW } },
      data: { status: 'pending', leaseUntil: null, nextAttemptAt: NOW },
    });
  });

  it('purges rows past 30 days, once a day', async () => {
    const h = harness();
    await tick(h);
    await tick(h);
    expect(h.prisma.webhookDelivery.deleteMany).toHaveBeenCalledTimes(1);
    expect(h.prisma.webhookDelivery.deleteMany).toHaveBeenCalledWith({
      where: {
        createdAt: { lt: ago(30 * 24 * HOUR) },
        status: { not: 'in_flight' },
      },
    });
  });
});

describe('WebhookDeliveryWorker management hooks', () => {
  it('redeliver pulls the same row forward', async () => {
    const h = harness();
    await h.worker.deliverNow('d9');
    expect(h.prisma.webhookDelivery.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'd9',
        status: { in: ['pending', 'failed', 'delivered'] },
      },
      data: { status: 'pending', nextAttemptAt: NOW, leaseUntil: null },
    });
  });

  it('sends a signed test and stores it as a one-shot delivery', async () => {
    const h = harness();
    h.prisma.state.webhooks = [webhook()];
    respond(200);
    const result = await h.worker.sendTest('wh1', { id: 1, username: 'alice' });

    expect(result).toEqual({
      ok: true,
      status: 200,
      durationMs: 42,
      error: null,
      errorCode: null,
      responseExcerpt: 'ok',
    });
    expect(h.prisma.webhookDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        webhookId: 'wh1',
        eventType: 'webhook.test',
        status: 'in_flight',
        attempts: 1,
        payload: {
          type: 'webhook.test',
          timestamp: NOW.toISOString(),
          data: {
            workspace_id: 'ws1',
            actor: { id: 1, username: 'alice' },
            webhook: { id: 'wh1', name: 'Zapier' },
          },
        },
      }) as unknown,
    });
    expect(signMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'test-delivery' }),
    );
    // A test never touches the failure streak.
    expect(h.prisma.webhook.updateMany).not.toHaveBeenCalled();
  });

  it('reports an SSRF refusal on test with its code', async () => {
    const h = harness();
    h.prisma.state.webhooks = [webhook()];
    fetchMock.mockRejectedValueOnce(
      new SafeOutboundError('scheme_not_allowed', 'Only https:// is allowed'),
    );
    const result = await h.worker.sendTest('wh1');
    expect(result).toMatchObject({
      ok: false,
      status: null,
      errorCode: 'scheme_not_allowed',
      error: 'Only https:// is allowed',
    });
  });

  it('does not disable on a failed test, even a 410', async () => {
    const h = harness();
    h.prisma.state.webhooks = [webhook()];
    respond(410);
    const result = await h.worker.sendTest('wh1');
    expect(result).toMatchObject({ ok: false, status: 410 });
    expect(h.prisma.state.webhooks[0].status).toBe('active');
  });

  it('answers 404 for an unknown webhook', async () => {
    const h = harness();
    await expect(h.worker.sendTest('nope')).rejects.toThrow(
      'Webhook not found',
    );
  });
});
