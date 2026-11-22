import type { PrismaService } from '../database/prisma.service';
import { DocumentController } from '../document/document.controller';
import { DocumentService } from '../document/document.service';
import { ApiV1DocumentsController } from '../api/v1/documents.controller';
import { ApiV1FoldersController } from '../api/v1/folders.controller';
import { FolderController } from '../folder/folder.controller';
import { FolderService } from '../folder/folder.service';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { WebhookEventService } from './webhook-event.service';

/**
 * The contract from docs/design/webhooks.md § Event catalog: emission lives
 * in the services, so the web routes and `/api/v1` — parallel controllers
 * over the same services — both emit, with the caller as the actor. Each
 * case drives one route of each surface through the *real* service over a
 * Prisma double and records what reaches `WebhookEventService`.
 */

const USER = 7;
const WS = 'w1';
const DOC = {
  id: 'd1',
  type: 'sheet',
  title: 'Plan',
  workspaceId: WS,
  folderId: null,
  authorID: USER,
  deletedAt: null,
  fileId: null,
};

function makePrisma() {
  const prisma = {
    document: {
      create: jest.fn().mockResolvedValue(DOC),
      findUnique: jest.fn().mockResolvedValue(DOC),
      findMany: jest.fn().mockResolvedValue([DOC]),
      update: jest.fn().mockResolvedValue({ ...DOC, title: 'Plan v2' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      updateManyAndReturn: jest.fn().mockResolvedValue([DOC]),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    folder: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  // Interactive transactions run on the same double.
  return Object.assign(prisma, {
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
  });
}

function makeEvents() {
  const emitDocumentEvent = jest.fn().mockResolvedValue(undefined);
  return {
    enabled: true,
    emitDocumentEvent,
    emitFolderEvent: jest.fn().mockResolvedValue(undefined),
    // A batch records into the same mock, so a bulk path counts like a
    // single one.
    batch: jest.fn((tx: unknown) => ({
      emitDocumentEvent: (input: unknown) => emitDocumentEvent(tx, input),
      folderRef: jest.fn().mockResolvedValue(null),
      preloadFolders: jest.fn().mockResolvedValue(undefined),
      flush: jest.fn().mockResolvedValue(undefined),
    })),
  };
}

const workspaceService = {
  resolveId: jest.fn((id: string) => Promise.resolve(id)),
  assertMember: jest.fn(() =>
    Promise.resolve({ workspaceId: WS, role: 'owner' }),
  ),
};
const req = (over: Record<string, unknown> = {}) =>
  ({
    user: { id: USER, username: 'ada', ...over },
  }) as unknown as AuthenticatedRequest;
const apiKeyReq = () =>
  req({ isApiKey: true, workspaceId: WS, scopes: ['read', 'write'] });

function surfaces() {
  const prisma = makePrisma();
  const events = makeEvents();
  const documentService = new DocumentService(
    prisma as unknown as PrismaService,
    events as unknown as WebhookEventService,
  );
  const folderService = new FolderService(
    prisma as unknown as PrismaService,
    events as unknown as WebhookEventService,
  );
  const unused = {} as never;
  const web = new DocumentController(
    documentService,
    unused,
    workspaceService as never,
    unused,
    unused,
    folderService,
  );
  const v1 = new ApiV1DocumentsController(
    documentService,
    unused,
    workspaceService as never,
    unused,
    unused,
    folderService,
  );
  const webFolders = new FolderController(
    folderService,
    workspaceService as never,
  );
  const v1Folders = new ApiV1FoldersController(
    folderService,
    workspaceService as never,
  );
  return { prisma, events, web, v1, webFolders, v1Folders };
}

/** `[type, actor]` of every document event emitted. */
const documentEvents = (events: ReturnType<typeof makeEvents>) =>
  events.emitDocumentEvent.mock.calls.map(([, input]) => {
    const e = input as { type: string; actor: unknown };
    return [e.type, e.actor];
  });

describe('webhook emission: web and /api/v1 routes both emit', () => {
  describe('document.created', () => {
    it('web', async () => {
      const { web, events } = surfaces();
      await web.createInWorkspace(WS, req(), { title: 'Plan' } as never);
      expect(documentEvents(events)).toEqual([['document.created', USER]]);
    });

    it('/api/v1', async () => {
      const { v1, events } = surfaces();
      await v1.create(WS, apiKeyReq(), { title: 'Plan' } as never);
      expect(documentEvents(events)).toEqual([['document.created', USER]]);
    });
  });

  describe('document.renamed', () => {
    it('web', async () => {
      const { web, events } = surfaces();
      await web.updateDocument(req(), 'd1', { title: 'Plan v2' } as never);
      expect(documentEvents(events)).toEqual([['document.renamed', USER]]);
    });

    it('/api/v1', async () => {
      const { v1, events } = surfaces();
      await v1.update(WS, 'd1', apiKeyReq(), { title: 'Plan v2' } as never);
      expect(documentEvents(events)).toEqual([['document.renamed', USER]]);
    });
  });

  describe('document.trashed', () => {
    it('web', async () => {
      const { web, events } = surfaces();
      await web.deleteDocument(req(), 'd1');
      expect(documentEvents(events)).toEqual([['document.trashed', USER]]);
    });

    it('/api/v1', async () => {
      const { v1, events } = surfaces();
      await v1.remove(WS, 'd1', apiKeyReq());
      expect(documentEvents(events)).toEqual([['document.trashed', USER]]);
    });
  });

  describe('folder.created', () => {
    const folder = { id: 'f1', name: 'A', parentId: null, workspaceId: WS };

    it('web', async () => {
      const { webFolders, prisma, events } = surfaces();
      prisma.folder.create.mockResolvedValue(folder);
      await webFolders.create(WS, req(), { name: 'A' } as never);
      expect(events.emitFolderEvent).toHaveBeenCalledWith(prisma, {
        type: 'folder.created',
        actor: USER,
        folder,
      });
    });

    it('/api/v1', async () => {
      const { v1Folders, prisma, events } = surfaces();
      prisma.folder.create.mockResolvedValue(folder);
      await v1Folders.create(WS, apiKeyReq(), { name: 'A' } as never);
      expect(events.emitFolderEvent).toHaveBeenCalledWith(prisma, {
        type: 'folder.created',
        actor: USER,
        folder,
      });
    });
  });
});
