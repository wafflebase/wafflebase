import { DocumentService } from './document.service';
import { PrismaService } from 'src/database/prisma.service';
import type { WebhookEventService } from '../webhook/webhook-event.service';

describe('DocumentService.updateDocument', () => {
  let update: jest.Mock;
  let service: DocumentService;

  beforeEach(() => {
    update = jest.fn().mockResolvedValue({ id: 'd1' });
    service = new DocumentService({
      document: { update },
    } as unknown as PrismaService);
  });

  it('advances updatedAt on a real metadata update (rename)', async () => {
    await service.updateDocument(
      { where: { id: 'd1' }, data: { title: 'New' } },
      1,
    );
    const arg = update.mock.calls[0][0] as {
      data: { title?: string; updatedAt?: Date };
    };
    expect(arg.data.title).toBe('New');
    expect(arg.data.updatedAt).toBeInstanceOf(Date);
  });

  it('does not bump updatedAt for an empty / no-op update', async () => {
    // An empty-body PATCH must not re-sort the doc to the top of the list.
    await service.updateDocument({ where: { id: 'd1' }, data: {} }, 1);
    const arg = update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data).not.toHaveProperty('updatedAt');
    expect(Object.keys(arg.data)).toHaveLength(0);
  });
});

describe('DocumentService trash', () => {
  let prisma: {
    document: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let service: DocumentService;

  beforeEach(() => {
    prisma = {
      document: {
        findUnique: jest.fn().mockResolvedValue({ id: 'd1' }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    service = new DocumentService(prisma as unknown as PrismaService);
  });

  it('reads live documents only by default', async () => {
    await service.document({ id: 'd1' });
    expect(prisma.document.findUnique).toHaveBeenCalledWith({
      where: { id: 'd1', deletedAt: null },
    });
  });

  // `getDocumentOrThrow` backs every /api/v1 document, tab, cell and content
  // route, so this is what makes them 404 on a trashed document.
  it('404s getDocumentOrThrow on a trashed document', async () => {
    prisma.document.findUnique.mockResolvedValue(null);
    await expect(
      service.getDocumentOrThrow({ id: 'd1', workspaceId: 'w' }),
    ).rejects.toThrow('Document not found');
    expect(prisma.document.findUnique).toHaveBeenCalledWith({
      where: { id: 'd1', workspaceId: 'w', deletedAt: null },
    });
  });

  it('reaches a trashed document only through documentIncludingTrashed', async () => {
    await service.documentIncludingTrashed({ id: 'd1' });
    expect(prisma.document.findUnique).toHaveBeenCalledWith({
      where: { id: 'd1' },
    });
  });

  it('reads the trashed side only through trashedDocument', async () => {
    await service.trashedDocument({ id: 'd1', workspaceId: 'w' });
    expect(prisma.document.findUnique).toHaveBeenCalledWith({
      where: { id: 'd1', workspaceId: 'w', deletedAt: { not: null } },
    });
  });

  // The trash condition is in the delete itself, so a restore that lands
  // after the caller read the trash list leaves the document alive.
  it('purges only a document still in the trash', async () => {
    await expect(service.purgeTrashedDocument('d1', 1)).resolves.toBe(true);
    expect(prisma.document.deleteMany).toHaveBeenCalledWith({
      where: { id: 'd1', deletedAt: { not: null } },
    });
    prisma.document.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.purgeTrashedDocument('d1', 1)).resolves.toBe(false);
  });

  it('reports exactly the ids a bulk purge destroyed', async () => {
    prisma.document.deleteMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    await expect(
      service.purgeTrashedDocuments(['a', 'b', 'c'], 1),
    ).resolves.toEqual(['a', 'c']);
  });

  it('filters every list to live documents', async () => {
    await service.documents({ where: { workspaceId: 'w' } });
    await service.listDocumentsWithAuthor({ where: { workspaceId: 'w' } });
    await service.documents({});
    const calls = prisma.document.findMany.mock.calls as Array<
      [{ where: Record<string, unknown> }]
    >;
    for (const [arg] of calls) {
      expect(arg.where).toMatchObject({ deletedAt: null });
    }
  });

  it('lists one workspace trash, most recently trashed first', async () => {
    await service.listTrash('w');
    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'w', deletedAt: { not: null } },
        orderBy: [{ deletedAt: 'desc' }, { id: 'asc' }],
      }),
    );
  });

  it('trashes only live rows and leaves updatedAt alone', async () => {
    await service.trashDocuments(['a', 'b'], 1);
    const [[arg]] = prisma.document.updateMany.mock.calls as Array<
      [{ where: unknown; data: Record<string, unknown> }]
    >;
    expect(arg.where).toEqual({ id: { in: ['a', 'b'] }, deletedAt: null });
    expect(arg.data.deletedAt).toBeInstanceOf(Date);
    expect(arg.data).not.toHaveProperty('updatedAt');
  });

  it('does not query when trashing nothing', async () => {
    await expect(service.trashDocuments([], 1)).resolves.toBe(0);
    expect(prisma.document.updateMany).not.toHaveBeenCalled();
  });

  it('restores a trashed row and returns it live', async () => {
    await expect(service.restoreDocument('d1', 1)).resolves.toEqual({
      id: 'd1',
    });
    expect(prisma.document.updateMany).toHaveBeenCalledWith({
      where: { id: 'd1', deletedAt: { not: null } },
      data: { deletedAt: null },
    });
  });

  it('returns null when restoring a row that is not in the trash', async () => {
    prisma.document.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.restoreDocument('d1', 1)).resolves.toBeNull();
    expect(prisma.document.findUnique).not.toHaveBeenCalled();
  });
});

/**
 * Webhook emission from the service, with the transaction client the write
 * ran on (docs/design/webhooks.md § Event catalog). Both the web routes and
 * `/api/v1` reach these methods; the controller specs assert they pass the
 * caller as the actor.
 */
describe('DocumentService webhook events', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'd1',
    type: 'sheet',
    title: 'Plan',
    workspaceId: 'w1',
    folderId: null as string | null,
    deletedAt: null as Date | null,
    ...over,
  });
  let prisma: {
    document: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let events: {
    enabled: boolean;
    emitDocumentEvent: jest.Mock;
    folderRef: jest.Mock;
  };
  let service: DocumentService;

  beforeEach(() => {
    prisma = {
      document: {
        create: jest.fn().mockResolvedValue(row()),
        findUnique: jest.fn().mockResolvedValue(row()),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue(row()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    events = {
      enabled: true,
      emitDocumentEvent: jest.fn().mockResolvedValue(undefined),
      folderRef: jest.fn((_tx: unknown, id: string | null) =>
        Promise.resolve(id ? { id, name: `name-${id}` } : null),
      ),
    };
    service = new DocumentService(
      prisma as unknown as PrismaService,
      events as unknown as WebhookEventService,
    );
  });

  const emitted = () =>
    events.emitDocumentEvent.mock.calls.map(
      ([, input]) => input as Record<string, unknown>,
    );

  it('emits document.created with its source inside the create transaction', async () => {
    await service.createDocument({} as never, {
      actorId: 7,
      source: { kind: 'upload' },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(events.emitDocumentEvent).toHaveBeenCalledWith(prisma, {
      type: 'document.created',
      actor: 7,
      document: row(),
      extra: { source: { kind: 'upload' } },
    });
  });

  it('leaves document.created to the caller when told to', async () => {
    await service.createDocument({} as never, null);
    expect(events.emitDocumentEvent).not.toHaveBeenCalled();
  });

  it('emits renamed only when the title changed', async () => {
    prisma.document.update.mockResolvedValue(row({ title: 'Plan v2' }));
    await service.updateDocument(
      { where: { id: 'd1' }, data: { title: 'Plan v2' } },
      7,
    );
    expect(emitted().map((e) => e.type)).toEqual(['document.renamed']);

    events.emitDocumentEvent.mockClear();
    prisma.document.update.mockResolvedValue(row());
    await service.updateDocument(
      { where: { id: 'd1' }, data: { title: 'Plan' } },
      7,
    );
    expect(events.emitDocumentEvent).not.toHaveBeenCalled();
  });

  it('emits moved with both folders, matched against either', async () => {
    prisma.document.findUnique.mockResolvedValue(row({ folderId: 'f1' }));
    prisma.document.update.mockResolvedValue(row({ folderId: 'f2' }));
    await service.updateDocument(
      { where: { id: 'd1' }, data: { folder: { connect: { id: 'f2' } } } },
      7,
    );
    expect(emitted()).toEqual([
      expect.objectContaining({
        type: 'document.moved',
        actor: 7,
        filterFolderId: ['f1', 'f2'],
        folder: { id: 'f2', name: 'name-f2' },
        extra: {
          from_folder: { id: 'f1', name: 'name-f1' },
          to_folder: { id: 'f2', name: 'name-f2' },
        },
      }),
    ]);
  });

  it('emits a cross-workspace move to both workspaces', async () => {
    prisma.document.findUnique.mockResolvedValue(row({ folderId: 'f1' }));
    prisma.document.update.mockResolvedValue(row({ workspaceId: 'w2' }));
    await service.updateDocument(
      { where: { id: 'd1' }, data: { workspace: { connect: { id: 'w2' } } } },
      7,
    );
    const moves = emitted();
    expect(moves.map((e) => [e.workspaceId, e.filterFolderId])).toEqual([
      ['w1', 'f1'],
      ['w2', null],
    ]);
    for (const e of moves) {
      expect(e.extra).toMatchObject({
        from_workspace_id: 'w1',
        to_workspace_id: 'w2',
      });
    }
  });

  it('emits one document.moved per document of a bulk move', async () => {
    prisma.document.findUnique
      .mockResolvedValueOnce(row({ id: 'a' }))
      .mockResolvedValueOnce(row({ id: 'b' }));
    prisma.document.update
      .mockResolvedValueOnce(row({ id: 'a', folderId: 'f' }))
      .mockResolvedValueOnce(row({ id: 'b', folderId: 'f' }));
    await service.moveDocuments(
      [
        { id: 'a', data: {} },
        { id: 'b', data: {} },
      ],
      7,
    );
    expect(emitted().map((e) => e.type)).toEqual([
      'document.moved',
      'document.moved',
    ]);
  });

  it('emits trashed for exactly the rows a bulk trash trashed', async () => {
    prisma.document.findMany.mockResolvedValue([
      row({ id: 'a' }),
      row({ id: 'b' }),
    ]);
    // `b` was trashed by somebody else between the read and the write.
    prisma.document.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    await expect(service.trashDocuments(['a', 'b'], 7)).resolves.toBe(1);
    expect(
      emitted().map((e) => [e.type, (e.document as { id: string }).id]),
    ).toEqual([['document.trashed', 'a']]);
  });

  it('emits restored with the live row', async () => {
    await service.restoreDocument('d1', 7);
    expect(emitted()).toEqual([
      expect.objectContaining({ type: 'document.restored', actor: 7 }),
    ]);
  });

  it('emits deleted with the row read before the purge, only if it won', async () => {
    const trashed = row({ deletedAt: new Date() });
    prisma.document.findUnique.mockResolvedValue(trashed);
    await service.purgeTrashedDocument('d1', 7);
    expect(events.emitDocumentEvent).toHaveBeenCalledWith(prisma, {
      type: 'document.deleted',
      actor: 7,
      document: trashed,
    });
    expect(prisma.document.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.document.deleteMany.mock.invocationCallOrder[0],
    );

    events.emitDocumentEvent.mockClear();
    prisma.document.deleteMany.mockResolvedValue({ count: 0 });
    await service.purgeTrashedDocument('d1', 7);
    expect(events.emitDocumentEvent).not.toHaveBeenCalled();
  });

  it('runs straight on the client, emitting nothing, while disabled', async () => {
    events.enabled = false;
    await service.createDocument({} as never, {
      actorId: 7,
      source: { kind: 'blank' },
    });
    await service.trashDocuments(['a'], 7);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
