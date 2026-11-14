import { DocumentService } from './document.service';
import { PrismaService } from 'src/database/prisma.service';

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
    await service.updateDocument({ where: { id: 'd1' }, data: { title: 'New' } });
    const arg = update.mock.calls[0][0] as {
      data: { title?: string; updatedAt?: Date };
    };
    expect(arg.data.title).toBe('New');
    expect(arg.data.updatedAt).toBeInstanceOf(Date);
  });

  it('does not bump updatedAt for an empty / no-op update', async () => {
    // An empty-body PATCH must not re-sort the doc to the top of the list.
    await service.updateDocument({ where: { id: 'd1' }, data: {} });
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
    await expect(service.purgeTrashedDocument('d1')).resolves.toBe(true);
    expect(prisma.document.deleteMany).toHaveBeenCalledWith({
      where: { id: 'd1', deletedAt: { not: null } },
    });
    prisma.document.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.purgeTrashedDocument('d1')).resolves.toBe(false);
  });

  it('reports exactly the ids a bulk purge destroyed', async () => {
    prisma.document.deleteMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    await expect(
      service.purgeTrashedDocuments(['a', 'b', 'c']),
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
    await service.trashDocuments(['a', 'b']);
    const [[arg]] = prisma.document.updateMany.mock.calls as Array<
      [{ where: unknown; data: Record<string, unknown> }]
    >;
    expect(arg.where).toEqual({ id: { in: ['a', 'b'] }, deletedAt: null });
    expect(arg.data.deletedAt).toBeInstanceOf(Date);
    expect(arg.data).not.toHaveProperty('updatedAt');
  });

  it('does not query when trashing nothing', async () => {
    await expect(service.trashDocuments([])).resolves.toBe(0);
    expect(prisma.document.updateMany).not.toHaveBeenCalled();
  });

  it('restores a trashed row and returns it live', async () => {
    await expect(service.restoreDocument('d1')).resolves.toEqual({ id: 'd1' });
    expect(prisma.document.updateMany).toHaveBeenCalledWith({
      where: { id: 'd1', deletedAt: { not: null } },
      data: { deletedAt: null },
    });
  });

  it('returns null when restoring a row that is not in the trash', async () => {
    prisma.document.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.restoreDocument('d1')).resolves.toBeNull();
    expect(prisma.document.findUnique).not.toHaveBeenCalled();
  });
});
