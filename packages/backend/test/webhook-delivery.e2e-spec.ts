import { createServer, type IncomingMessage, type Server } from 'http';
import type { AddressInfo } from 'net';
import { PrismaService } from 'src/database/prisma.service';
import type { PgBus } from 'src/common/pg-bus';
import type { NotificationService } from 'src/notification/notification.service';
import { loadWebhookConfig } from 'src/webhook/webhook-config';
import { WebhookDeliveryWorker } from 'src/webhook/webhook-delivery.worker';
import { WebhookEventService } from 'src/webhook/webhook-event.service';
import { encryptSecret } from 'src/webhook/webhook-secret';
import {
  generateWebhookSecret,
  verifyWebhook,
} from 'src/webhook/webhook-signer';
import {
  createUserFactory,
  createWorkspace,
  describeDb,
  setIntegrationEnvDefaults,
} from './helpers/integration-helpers';

/**
 * The multi-replica claim: two workers on separate connections — standing in
 * for two backend replicas — drain one queue against a local receiver, and
 * no row is ever sent twice or more than two at a time to one endpoint.
 * Writes only its own workspace's rows and deletes them afterwards.
 */
describeDb('WebhookDeliveryWorker integration', () => {
  const HOOKS = 5;
  const PER_HOOK = 10;

  let prismaA: PrismaService;
  let prismaB: PrismaService;
  let server: Server;
  let origin: string;
  const received: { id: string; hook: string; valid: boolean }[] = [];
  const concurrent = new Map<string, number>();
  let maxConcurrent = 0;
  const secrets = new Map<string, string>();
  let workspaceId: string;
  let userId: number;

  const config = {
    ...loadWebhookConfig({ WAFFLEBASE_WEBHOOKS_ENABLED: 'true' }),
    allowedCidrs: ['127.0.0.1/32'],
    allowHttp: true,
    frontendOrigin: 'http://localhost:5173',
  };
  // The loop is driven by hand; nothing listens.
  const bus = {
    listen: () => Promise.resolve(() => Promise.resolve()),
  } as unknown as PgBus;
  const notifications = {
    createWebhookAlert: () => Promise.resolve({ created: 0 }),
  } as unknown as NotificationService;

  function makeWorker(prisma: PrismaService) {
    const events = new WebhookEventService(config, prisma);
    return new WebhookDeliveryWorker(
      prisma,
      events,
      notifications,
      config,
      bus,
    );
  }

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString('utf8')));
      req.on('end', () => resolve(body));
    });
  }

  beforeAll(async () => {
    setIntegrationEnvDefaults();
    prismaA = new PrismaService();
    prismaB = new PrismaService();
    await Promise.all([prismaA.$connect(), prismaB.$connect()]);

    server = createServer((req, res) => {
      const hook = (req.url ?? '').split('/').pop() ?? '';
      const now = (concurrent.get(hook) ?? 0) + 1;
      concurrent.set(hook, now);
      maxConcurrent = Math.max(maxConcurrent, now);
      void readBody(req).then((body) => {
        const headers = Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [k, String(v)]),
        );
        received.push({
          id: headers['webhook-id'],
          hook,
          valid: verifyWebhook({
            headers,
            body,
            secret: secrets.get(hook) ?? '',
          }),
        });
        // Slow enough that sends overlap across both workers.
        setTimeout(() => {
          concurrent.set(hook, (concurrent.get(hook) ?? 1) - 1);
          res.writeHead(200).end('ok');
        }, 15);
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const user = await createUserFactory(prismaA, `whk-${Date.now()}`)();
    userId = user.id;
    workspaceId = (await createWorkspace(prismaA, user.id, 'whk')).id;
  });

  afterAll(async () => {
    if (workspaceId) {
      await prismaA.workspace.deleteMany({ where: { id: workspaceId } });
    }
    if (userId) await prismaA.user.deleteMany({ where: { id: userId } });
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await Promise.all([prismaA?.$disconnect(), prismaB?.$disconnect()]);
  });

  async function createHook(name: string) {
    const secret = generateWebhookSecret();
    const hook = await prismaA.webhook.create({
      data: {
        workspaceId,
        createdBy: userId,
        name,
        url: `${origin}/hook/pending`,
        events: [],
        documentTypes: [],
        folderIds: [],
        secretEnc: encryptSecret(secret),
      },
    });
    await prismaA.webhook.update({
      where: { id: hook.id },
      data: { url: `${origin}/hook/${hook.id}` },
    });
    secrets.set(hook.id, secret);
    return hook;
  }

  it('two workers never double-deliver a row', async () => {
    const ids: string[] = [];
    for (let i = 0; i < HOOKS; i++) {
      const hook = await createHook(`hook-${i}`);
      for (let j = 0; j < PER_HOOK; j++) {
        const row = await prismaA.webhookDelivery.create({
          data: {
            webhookId: hook.id,
            eventType: 'document.created',
            payload: {
              type: 'document.created',
              timestamp: new Date().toISOString(),
              data: { workspace_id: workspaceId, actor: null, n: j },
            },
          },
        });
        ids.push(row.id);
      }
    }

    const a = makeWorker(prismaA);
    const b = makeWorker(prismaB);
    const deadline = Date.now() + 30_000;
    const pump = async (w: WebhookDeliveryWorker) => {
      while (Date.now() < deadline) {
        await w.runOnce();
        const left = await prismaA.webhookDelivery.count({
          where: { id: { in: ids }, status: { not: 'delivered' } },
        });
        if (left === 0) break;
        await new Promise((r) => setTimeout(r, 5));
      }
      await w.drain();
    };
    await Promise.all([pump(a), pump(b)]);

    const rows = await prismaA.webhookDelivery.findMany({
      where: { id: { in: ids } },
    });
    expect(rows.every((r) => r.status === 'delivered')).toBe(true);
    expect(rows.every((r) => r.attempts === 1)).toBe(true);

    const sent = received.map((r) => r.id).filter((id) => ids.includes(id));
    expect(sent).toHaveLength(ids.length);
    expect(new Set(sent).size).toBe(ids.length);
    expect(received.every((r) => r.valid)).toBe(true);
    // Per-endpoint concurrency held across both replicas.
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  }, 40_000);

  it('flushes a quiet content window into content_updated, once', async () => {
    const hook = await createHook('content');
    const document = await prismaA.document.create({
      data: { title: 'Q4 plan', type: 'sheet', workspaceId, authorID: userId },
    });
    const firstSeenAt = new Date(Date.now() - 4 * 60_000);
    const lastIssuedAt = new Date(Date.now() - 2 * 60_000);
    await prismaA.webhookContentPending.create({
      data: {
        documentId: document.id,
        workspaceId,
        firstSeenAt,
        lastIssuedAt,
        apiWriters: [
          { api_key_id: 'k1', user_id: userId, at: lastIssuedAt.toISOString() },
        ],
      },
    });

    const a = makeWorker(prismaA);
    const b = makeWorker(prismaB);
    await Promise.all([a.runOnce(), b.runOnce()]);
    await Promise.all([a.drain(), b.drain()]);

    expect(
      await prismaA.webhookContentPending.count({
        where: { documentId: document.id },
      }),
    ).toBe(0);
    const deliveries = await prismaA.webhookDelivery.findMany({
      where: { webhookId: hook.id, eventType: 'document.content_updated' },
    });
    expect(deliveries).toHaveLength(1);
    const payload = deliveries[0].payload as {
      data: Record<string, unknown>;
    };
    expect(payload.data).toMatchObject({
      workspace_id: workspaceId,
      actor: null,
      document: { id: document.id, title: 'Q4 plan', folder: null },
      window_start: firstSeenAt.toISOString(),
      updated_at: lastIssuedAt.toISOString(),
      api_writers: [
        { api_key_id: 'k1', user_id: userId, at: lastIssuedAt.toISOString() },
      ],
    });
  });

  it('returns an expired lease to pending', async () => {
    const hook = await createHook('lease');
    await prismaA.webhook.update({
      where: { id: hook.id },
      data: { status: 'disabled' },
    });
    const row = await prismaA.webhookDelivery.create({
      data: {
        webhookId: hook.id,
        eventType: 'document.created',
        payload: { type: 'document.created', timestamp: '', data: {} },
        status: 'in_flight',
        attempts: 1,
        leaseUntil: new Date(Date.now() - 1_000),
      },
    });
    await makeWorker(prismaA).runOnce();
    expect(
      await prismaA.webhookDelivery.findUnique({ where: { id: row.id } }),
    ).toMatchObject({ status: 'pending', leaseUntil: null, attempts: 1 });
  });
});
