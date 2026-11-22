import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../database/prisma.service';
import { loadWebhookConfig, MAX_PAYLOAD_BYTES } from './webhook-config';
import {
  WebhookEventService,
  webhookMatches,
  writeWithEvents,
} from './webhook-event.service';

const ON = loadWebhookConfig({
  WAFFLEBASE_WEBHOOKS_ENABLED: 'true',
  FRONTEND_URL: 'https://app.example.com',
  WAFFLEBASE_API_ORIGIN: 'https://api.example.com',
});
const OFF = loadWebhookConfig({});

const hook = (id: string, over: Partial<Record<string, string[]>> = {}) => ({
  id,
  events: [] as string[],
  documentTypes: [] as string[],
  folderIds: [] as string[],
  ...over,
});

/** A transaction client double recording what `emit` writes. */
function makeTx(hooks: ReturnType<typeof hook>[] = []) {
  return {
    webhook: { findMany: jest.fn().mockResolvedValue(hooks) },
    webhookDelivery: {
      createMany: jest.fn().mockResolvedValue({ count: hooks.length }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 7, username: 'ada' }),
    },
    folder: {
      findMany: jest.fn().mockResolvedValue([{ id: 'f1', name: 'Planning' }]),
    },
    $executeRaw: jest.fn().mockResolvedValue(0),
  };
}
type Tx = ReturnType<typeof makeTx>;
const asTx = (tx: Tx) => tx as unknown as Prisma.TransactionClient;

function makeService(config = ON) {
  const prisma = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn('tx')),
  };
  const service = new WebhookEventService(
    config,
    prisma as unknown as PrismaService,
  );
  return { service, prisma };
}

/** The `data` rows `createMany` was given. */
function deliveries(tx: Tx) {
  const [[arg]] = tx.webhookDelivery.createMany.mock.calls as Array<
    [{ data: Array<Record<string, unknown>> }]
  >;
  return arg.data;
}

/** The SQL text and values of a tagged `$executeRaw` call. */
function rawCall(mock: jest.Mock, index = 0) {
  const [strings, ...values] = mock.mock.calls[index] as [
    TemplateStringsArray,
    ...unknown[],
  ];
  return { sql: strings.join('?'), values };
}

describe('webhookMatches', () => {
  it('treats every empty filter as "all"', () => {
    expect(
      webhookMatches(hook('h'), {
        type: 'document.created',
        documentType: 'sheet',
        folderId: 'f1',
      }),
    ).toBe(true);
  });

  it('filters on the event type', () => {
    const h = hook('h', { events: ['document.renamed'] });
    expect(webhookMatches(h, { type: 'document.renamed' })).toBe(true);
    expect(webhookMatches(h, { type: 'document.created' })).toBe(false);
  });

  it('applies the document-type filter only to events that carry one', () => {
    const h = hook('h', { documentTypes: ['doc'] });
    expect(
      webhookMatches(h, { type: 'document.created', documentType: 'doc' }),
    ).toBe(true);
    expect(
      webhookMatches(h, { type: 'document.created', documentType: 'sheet' }),
    ).toBe(false);
    expect(webhookMatches(h, { type: 'member.joined' })).toBe(true);
  });

  it('applies the folder filter only when a folder is given, and never to the root', () => {
    const h = hook('h', { folderIds: ['f1'] });
    expect(
      webhookMatches(h, { type: 'document.created', folderId: 'f1' }),
    ).toBe(true);
    expect(
      webhookMatches(h, { type: 'document.created', folderId: 'f2' }),
    ).toBe(false);
    expect(
      webhookMatches(h, { type: 'document.created', folderId: null }),
    ).toBe(false);
    expect(webhookMatches(h, { type: 'folder.created' })).toBe(true);
  });

  it('matches a move against the folder it left or the one it entered', () => {
    const h = hook('h', { folderIds: ['f1'] });
    expect(
      webhookMatches(h, { type: 'document.moved', folderId: ['f1', null] }),
    ).toBe(true);
    expect(
      webhookMatches(h, { type: 'document.moved', folderId: [null, 'f1'] }),
    ).toBe(true);
    expect(
      webhookMatches(h, { type: 'document.moved', folderId: ['f2', null] }),
    ).toBe(false);
  });
});

describe('WebhookEventService.emit', () => {
  const input = {
    workspaceId: 'w1',
    type: 'document.created' as const,
    actor: { id: 7, username: 'ada' },
    data: { document: { id: 'd1' } },
    documentType: 'sheet',
    folderId: null,
  };

  it('is a no-op while the feature is disabled', async () => {
    const tx = makeTx([hook('h1')]);
    await makeService(OFF).service.emit(asTx(tx), input);
    expect(tx.webhook.findMany).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('inserts one pending delivery per matching active webhook, then notifies', async () => {
    const tx = makeTx([
      hook('h1'),
      hook('h2', { events: ['document.deleted'] }),
      hook('h3', { documentTypes: ['sheet'] }),
    ]);
    await makeService().service.emit(asTx(tx), input);

    expect(tx.webhook.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'w1', status: 'active' },
      }),
    );
    const rows = deliveries(tx);
    expect(rows.map((r) => r.webhookId)).toEqual(['h1', 'h3']);
    for (const row of rows) {
      expect(row).toMatchObject({
        eventType: 'document.created',
        status: 'pending',
        nextAttemptAt: expect.any(Date) as Date,
      });
    }
    expect(rows[0].payload).toEqual({
      type: 'document.created',
      timestamp: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) as string,
      data: {
        workspace_id: 'w1',
        actor: { id: 7, username: 'ada' },
        document: { id: 'd1' },
      },
    });
    const notify = rawCall(tx.$executeRaw);
    expect(notify.sql).toContain('pg_notify');
    expect(notify.values).toEqual(['webhook', 'w1']);
    // Notify after the insert, so the woken worker finds the rows.
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeGreaterThan(
      tx.webhookDelivery.createMany.mock.invocationCallOrder[0],
    );
  });

  it('never lets a restricted event leave', async () => {
    const tx = makeTx([hook('h1')]);
    await makeService().service.emit(asTx(tx), {
      ...input,
      visibility: 'restricted',
    });
    expect(tx.webhook.findMany).not.toHaveBeenCalled();
    expect(tx.webhookDelivery.createMany).not.toHaveBeenCalled();
  });

  it('delivers a public event like any other', async () => {
    const tx = makeTx([hook('h1')]);
    await makeService().service.emit(asTx(tx), {
      ...input,
      visibility: 'public',
    });
    expect(deliveries(tx)).toHaveLength(1);
  });

  it('writes and notifies nothing when no webhook matches', async () => {
    const tx = makeTx([hook('h1', { events: ['member.joined'] })]);
    await makeService().service.emit(asTx(tx), input);
    expect(tx.webhookDelivery.createMany).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.user.findUnique).not.toHaveBeenCalled();
  });

  it('resolves an actor given as a user id, and passes null through', async () => {
    const tx = makeTx([hook('h1')]);
    const { service } = makeService();
    await service.emit(asTx(tx), { ...input, actor: 7 });
    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      select: { id: true, username: true },
    });
    expect(
      (deliveries(tx)[0].payload as { data: { actor: unknown } }).data.actor,
    ).toEqual({ id: 7, username: 'ada' });

    const tx2 = makeTx([hook('h1')]);
    await service.emit(asTx(tx2), { ...input, actor: null });
    expect(
      (deliveries(tx2)[0].payload as { data: { actor: unknown } }).data.actor,
    ).toBeNull();
  });

  it('drops an event whose data is over the payload cap rather than failing the write', async () => {
    const tx = makeTx([hook('h1')]);
    await expect(
      makeService().service.emit(asTx(tx), {
        ...input,
        data: { document: { title: 'x'.repeat(MAX_PAYLOAD_BYTES) } },
      }),
    ).resolves.toBeUndefined();
    expect(tx.webhookDelivery.createMany).not.toHaveBeenCalled();
  });

  it('never fans webhook.test out', async () => {
    const tx = makeTx([hook('h1')]);
    await makeService().service.emit(asTx(tx), {
      ...input,
      type: 'webhook.test',
    });
    expect(tx.webhook.findMany).not.toHaveBeenCalled();
  });
});

describe('WebhookEventService family helpers', () => {
  const doc = {
    id: 'd1',
    type: 'sheet',
    title: 'Q4 plan',
    workspaceId: 'w1',
    folderId: 'f1',
  };

  it('describes a document with its folder, links and filters', async () => {
    const tx = makeTx([
      hook('h1', { folderIds: ['f1'], documentTypes: ['sheet'] }),
    ]);
    await makeService().service.emitDocumentEvent(asTx(tx), {
      type: 'document.created',
      actor: null,
      document: doc,
      extra: { source: { kind: 'blank' } },
    });
    expect(deliveries(tx)[0].payload).toMatchObject({
      data: {
        workspace_id: 'w1',
        actor: null,
        document: {
          id: 'd1',
          type: 'sheet',
          title: 'Q4 plan',
          folder: { id: 'f1', name: 'Planning' },
        },
        url: 'https://app.example.com/s/d1',
        api_url: 'https://api.example.com/api/v1/workspaces/w1/documents/d1',
        source: { kind: 'blank' },
      },
    });
  });

  it('routes a document event to another workspace when told to', async () => {
    const tx = makeTx([hook('h1')]);
    await makeService().service.emitDocumentEvent(asTx(tx), {
      type: 'document.moved',
      actor: null,
      document: doc,
      folder: null,
      workspaceId: 'w0',
      filterFolderId: null,
    });
    expect(tx.webhook.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'w0', status: 'active' },
      }),
    );
    expect(tx.folder.findMany).not.toHaveBeenCalled();
  });

  it('describes a member from their user row', async () => {
    const tx = makeTx([hook('h1')]);
    tx.user.findUnique.mockResolvedValue({
      id: 3,
      username: 'bo',
      email: 'bo@example.com',
    });
    await makeService().service.emitMemberEvent(asTx(tx), {
      type: 'member.joined',
      workspaceId: 'w1',
      actor: { id: 3, username: 'bo' },
      userId: 3,
      role: 'member',
    });
    expect(deliveries(tx)[0].payload).toMatchObject({
      type: 'member.joined',
      data: {
        member: {
          id: 3,
          username: 'bo',
          email: 'bo@example.com',
          role: 'member',
          kind: 'user',
        },
      },
    });
  });

  it('describes a folder, unfiltered by the document filters', async () => {
    const tx = makeTx([hook('h1', { folderIds: ['other'] })]);
    await makeService().service.emitFolderEvent(asTx(tx), {
      type: 'folder.created',
      actor: null,
      folder: { id: 'f9', name: 'New', parentId: null, workspaceId: 'w1' },
    });
    expect(deliveries(tx)[0].payload).toMatchObject({
      data: { folder: { id: 'f9', name: 'New', parent_id: null } },
    });
  });

  it('skips the lookups entirely while disabled', async () => {
    const tx = makeTx([hook('h1')]);
    const { service } = makeService(OFF);
    await service.emitDocumentEvent(asTx(tx), {
      type: 'document.created',
      actor: 7,
      document: doc,
    });
    await service.emitMemberEvent(asTx(tx), {
      type: 'member.joined',
      workspaceId: 'w1',
      actor: 7,
      userId: 7,
      role: 'owner',
    });
    expect(tx.folder.findMany).not.toHaveBeenCalled();
    expect(tx.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('WebhookEventService.batch', () => {
  const doc = (id: string, folderId: string | null) => ({
    id,
    type: 'sheet',
    title: `Doc ${id}`,
    workspaceId: 'w1',
    folderId,
  });

  // A bulk trash or move of a thousand documents must not cost five or six
  // statements per document inside one interactive transaction.
  it('reads hooks, folders and the actor once and writes once', async () => {
    const tx = makeTx([hook('h1'), hook('h2')]);
    const batch = makeService().service.batch(asTx(tx));
    await batch.preloadFolders(['f1', 'f1', null]);
    for (let i = 0; i < 50; i++) {
      await batch.emitDocumentEvent({
        type: 'document.trashed',
        actor: 7,
        document: doc(`d${i}`, i % 2 ? 'f1' : null),
      });
    }
    expect(tx.webhookDelivery.createMany).not.toHaveBeenCalled();
    await batch.flush();

    expect(tx.webhook.findMany).toHaveBeenCalledTimes(1);
    expect(tx.folder.findMany).toHaveBeenCalledTimes(1);
    expect(tx.user.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.webhookDelivery.createMany).toHaveBeenCalledTimes(1);
    expect(deliveries(tx)).toHaveLength(100);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(deliveries(tx)[2].payload).toMatchObject({
      data: {
        actor: { id: 7, username: 'ada' },
        document: { id: 'd1', folder: { id: 'f1', name: 'Planning' } },
      },
    });
  });

  it('looks nothing up for an event no webhook takes', async () => {
    const tx = makeTx([hook('h1', { events: ['folder.created'] })]);
    const batch = makeService().service.batch(asTx(tx));
    await batch.emitDocumentEvent({
      type: 'document.trashed',
      actor: 7,
      document: doc('d1', 'f1'),
    });
    await batch.flush();
    expect(tx.folder.findMany).not.toHaveBeenCalled();
    expect(tx.user.findUnique).not.toHaveBeenCalled();
    expect(tx.webhookDelivery.createMany).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('notifies each workspace it wrote for', async () => {
    const tx = makeTx([hook('h1')]);
    const batch = makeService().service.batch(asTx(tx));
    for (const workspaceId of ['w1', 'w2', 'w1']) {
      await batch.emitDocumentEvent({
        type: 'document.moved',
        actor: null,
        document: doc('d1', null),
        folder: null,
        workspaceId,
      });
    }
    await batch.flush();
    const notified = (tx.$executeRaw.mock.calls as unknown[][]).map(
      (c) => c[2],
    );
    expect(notified).toEqual(['w1', 'w2']);
  });

  it('leaves the links out when told to', async () => {
    const tx = makeTx([hook('h1')]);
    await makeService().service.emitDocumentEvent(asTx(tx), {
      type: 'document.moved',
      actor: null,
      document: doc('d1', null),
      folder: null,
      links: false,
    });
    const data = (deliveries(tx)[0].payload as { data: object }).data;
    expect(data).not.toHaveProperty('url');
    expect(data).not.toHaveProperty('api_url');
  });
});

describe('WebhookEventService content_updated intake', () => {
  it('upserts the coalescing window for a live, subscribed document', async () => {
    const { service, prisma } = makeService();
    const at = new Date('2026-11-20T09:12:44.000Z');
    await service.noteContentChange('d1', at);
    const { sql, values } = rawCall(prisma.$executeRaw);
    expect(sql).toContain('INSERT INTO "WebhookContentPending"');
    expect(sql).toContain('"deletedAt" IS NULL');
    expect(sql).toContain('ON CONFLICT ("documentId") DO UPDATE');
    // Only `lastIssuedAt` moves on conflict; `firstSeenAt` keeps the window open
    // where it was.
    expect(sql).not.toMatch(/DO UPDATE[\s\S]*"firstSeenAt"/);
    expect(values).toContain('d1');
    expect(JSON.stringify(values)).toContain('2026-11-20T09:12:44.000Z');
  });

  it('appends an API writer, one entry per key', async () => {
    const { service, prisma } = makeService();
    await service.noteApiWrite(
      'd1',
      { apiKeyId: 'k1', userId: 7 },
      new Date('2026-11-20T09:10:02.000Z'),
    );
    const { sql, values } = rawCall(prisma.$executeRaw);
    expect(sql).toContain('"apiWriters"');
    expect(sql).toContain("DISTINCT ON (w->>'api_key_id')");
    // Keeps the window open for Yorkie's own (later) event for this write.
    expect(sql).toMatch(/SET "lastIssuedAt" = GREATEST\(/);
    expect(values).toContain(
      JSON.stringify([
        { api_key_id: 'k1', user_id: 7, at: '2026-11-20T09:10:02.000Z' },
      ]),
    );
  });

  it('writes nothing while disabled', async () => {
    const { service, prisma } = makeService(OFF);
    await service.noteContentChange('d1', new Date());
    await service.noteApiWrite('d1', { apiKeyId: 'k1', userId: 7 });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('writeWithEvents', () => {
  it('runs in a transaction only while enabled', async () => {
    const { service, prisma } = makeService();
    await expect(
      writeWithEvents(prisma as never, service, (tx) =>
        Promise.resolve(tx as unknown),
      ),
    ).resolves.toBe('tx');

    const off = makeService(OFF);
    await expect(
      writeWithEvents(off.prisma as never, off.service, (tx) =>
        Promise.resolve(tx as unknown),
      ),
    ).resolves.toBe(off.prisma);
    expect(off.prisma.$transaction).not.toHaveBeenCalled();
  });
});
