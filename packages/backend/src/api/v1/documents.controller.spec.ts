import {
  ForbiddenException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'http';
import * as request from 'supertest';
import { ApiV1DocumentsController } from './documents.controller';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ApiKeyWriteScopeGuard } from './api-key-write-scope.guard';
import { DocumentService } from '../../document/document.service';
import { DocumentCopyService } from '../../document/document-copy.service';
import { FolderService } from '../../folder/folder.service';
import { WorkspaceService } from '../../workspace/workspace.service';
import { YorkieAdminService } from '../../yorkie/yorkie-admin.service';
import { FileService } from '../../file/file.service';

const WS = 'ws-1';
const AUTHOR = 1;
const OWNER = 2;
const MEMBER = 3;

describe('ApiV1DocumentsController.remove permissions', () => {
  let controller: ApiV1DocumentsController;
  let documentService: {
    getDocumentOrThrow: jest.Mock;
    deleteDocument: jest.Mock;
  };
  let workspaceService: { assertMember: jest.Mock };
  let fileService: { delete: jest.Mock };

  beforeEach(() => {
    documentService = {
      getDocumentOrThrow: jest
        .fn()
        .mockResolvedValue({ id: 'doc-1', workspaceId: WS, authorID: AUTHOR }),
      deleteDocument: jest.fn().mockResolvedValue({ id: 'doc-1' }),
    };
    workspaceService = {
      assertMember: jest.fn().mockResolvedValue({ role: 'member' }),
    };
    fileService = { delete: jest.fn().mockResolvedValue(undefined) };
    controller = new ApiV1DocumentsController(
      documentService as never,
      { getEditors: jest.fn() } as never,
      workspaceService as never,
      fileService as never,
      { copy: jest.fn() } as never,
      { assertSameWorkspace: jest.fn() } as never,
    );
  });

  const req = (userId: number, isApiKey = false, scopes?: string[]) =>
    ({ user: { id: userId, isApiKey, scopes } }) as never;

  it('forbids a plain member from deleting a document they do not own', async () => {
    workspaceService.assertMember.mockResolvedValue({ role: 'member' });
    await expect(
      controller.remove(WS, 'doc-1', req(MEMBER)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(documentService.deleteDocument).not.toHaveBeenCalled();
  });

  it('lets the workspace owner delete any document', async () => {
    workspaceService.assertMember.mockResolvedValue({ role: 'owner' });
    await expect(
      controller.remove(WS, 'doc-1', req(OWNER)),
    ).resolves.toMatchObject({ id: 'doc-1' });
  });

  it('lets the document author delete their own document', async () => {
    workspaceService.assertMember.mockResolvedValue({ role: 'member' });
    await expect(
      controller.remove(WS, 'doc-1', req(AUTHOR)),
    ).resolves.toMatchObject({ id: 'doc-1' });
  });

  it('lets an API key minted by an owner delete any document', async () => {
    workspaceService.assertMember.mockResolvedValue({ role: 'owner' });
    await expect(
      controller.remove(WS, 'doc-1', req(OWNER, true, ['read', 'write'])),
    ).resolves.toMatchObject({ id: 'doc-1' });
    expect(workspaceService.assertMember).toHaveBeenCalledWith(WS, OWNER);
  });

  // A key carries its minter's authority as it stands now, not as it stood at
  // mint time — otherwise removing somebody from a workspace would leave every
  // key they ever minted deleting documents.
  it('forbids an API key whose minter is no longer a manager', async () => {
    workspaceService.assertMember.mockResolvedValue({ role: 'member' });
    await expect(
      controller.remove(WS, 'doc-1', req(MEMBER, true, ['read', 'write'])),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(documentService.deleteDocument).not.toHaveBeenCalled();
  });

  // A read-scoped key is refused before this handler runs — see
  // `api-key-write-scope.guard.spec.ts`, which covers every mutating method
  // and asserts the guard is mounted on this controller.

  it('deletes the stored blob alongside a blob-backed document', async () => {
    const fileId = '11111111-2222-3333-4444-555555555555.zip';
    documentService.getDocumentOrThrow.mockResolvedValue({
      id: 'doc-1',
      workspaceId: WS,
      authorID: AUTHOR,
      fileId,
    });
    await controller.remove(WS, 'doc-1', req(AUTHOR));
    expect(fileService.delete).toHaveBeenCalledWith(fileId);
  });

  it('does not attempt a blob delete for a CRDT document', async () => {
    await controller.remove(WS, 'doc-1', req(AUTHOR));
    expect(fileService.delete).not.toHaveBeenCalled();
  });

  it('still deletes the document when blob cleanup fails', async () => {
    documentService.getDocumentOrThrow.mockResolvedValue({
      id: 'doc-1',
      workspaceId: WS,
      authorID: AUTHOR,
      fileId: '11111111-2222-3333-4444-555555555555.zip',
    });
    fileService.delete.mockRejectedValue(new Error('s3 down'));
    await expect(
      controller.remove(WS, 'doc-1', req(AUTHOR)),
    ).resolves.toMatchObject({ id: 'doc-1' });
  });
});

describe('ApiV1DocumentsController copy and move-to-folder', () => {
  let controller: ApiV1DocumentsController;
  let documentService: {
    getDocumentOrThrow: jest.Mock;
    updateDocument: jest.Mock;
  };
  let workspaceService: { assertMember: jest.Mock };
  let documentCopyService: { copy: jest.Mock };
  let folderService: { assertSameWorkspace: jest.Mock };

  const doc = { id: 'doc-1', workspaceId: WS, authorID: AUTHOR };

  beforeEach(() => {
    documentService = {
      getDocumentOrThrow: jest.fn().mockResolvedValue(doc),
      updateDocument: jest.fn().mockResolvedValue({ id: 'doc-1' }),
    };
    workspaceService = {
      assertMember: jest.fn().mockResolvedValue({ role: 'member' }),
    };
    documentCopyService = {
      copy: jest.fn().mockResolvedValue({ id: 'doc-2', title: 'X (copy)' }),
    };
    folderService = {
      assertSameWorkspace: jest.fn().mockResolvedValue(undefined),
    };
    controller = new ApiV1DocumentsController(
      documentService as never,
      { getEditors: jest.fn() } as never,
      workspaceService as never,
      { delete: jest.fn() } as never,
      documentCopyService as never,
      folderService as never,
    );
  });

  const req = (userId: number, isApiKey = false) =>
    ({ user: { id: userId, isApiKey } }) as never;

  describe('copy', () => {
    // A copy neither modifies, moves, nor destroys the source, so it is gated
    // on membership alone — unlike move and delete.
    it('lets a plain member copy a document they do not own', async () => {
      await expect(
        controller.copy(WS, 'doc-1', req(MEMBER)),
      ).resolves.toMatchObject({ id: 'doc-2' });
      expect(documentCopyService.copy).toHaveBeenCalledWith(doc, MEMBER);
    });

    it('scopes the source lookup to the route workspace', async () => {
      await controller.copy(WS, 'doc-1', req(MEMBER));
      expect(documentService.getDocumentOrThrow).toHaveBeenCalledWith({
        id: 'doc-1',
        workspaceId: WS,
      });
    });
  });

  describe('update', () => {
    it('lets any member rename a document they do not own', async () => {
      await controller.update(WS, 'doc-1', req(MEMBER), { title: 'New' });
      expect(documentService.updateDocument).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: { title: 'New' },
      });
    });

    it('forbids a plain member from filing a document they do not own', async () => {
      await expect(
        controller.update(WS, 'doc-1', req(MEMBER), { folderId: 'f-1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(documentService.updateDocument).not.toHaveBeenCalled();
    });

    it('lets the document author move it into a folder', async () => {
      await controller.update(WS, 'doc-1', req(AUTHOR), { folderId: 'f-1' });
      expect(folderService.assertSameWorkspace).toHaveBeenCalledWith('f-1', WS);
      expect(documentService.updateDocument).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: { folder: { connect: { id: 'f-1' } } },
      });
    });

    it('lets the workspace owner move any document', async () => {
      workspaceService.assertMember.mockResolvedValue({ role: 'owner' });
      await controller.update(WS, 'doc-1', req(OWNER), { folderId: 'f-1' });
      expect(documentService.updateDocument).toHaveBeenCalled();
    });

    it('treats an explicit null folder as a move to the workspace root', async () => {
      await controller.update(WS, 'doc-1', req(AUTHOR), { folderId: null });
      expect(folderService.assertSameWorkspace).not.toHaveBeenCalled();
      expect(documentService.updateDocument).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: { folder: { disconnect: true } },
      });
    });

    it('refuses a folder from another workspace', async () => {
      folderService.assertSameWorkspace.mockRejectedValue(
        new Error('Folder must belong to the same workspace'),
      );
      await expect(
        controller.update(WS, 'doc-1', req(AUTHOR), { folderId: 'f-other' }),
      ).rejects.toThrow('Folder must belong to the same workspace');
      expect(documentService.updateDocument).not.toHaveBeenCalled();
    });

    it('lets an API key minted by an owner move any document', async () => {
      workspaceService.assertMember.mockResolvedValue({ role: 'owner' });
      await controller.update(WS, 'doc-1', req(OWNER, true), {
        folderId: 'f-1',
      });
      expect(workspaceService.assertMember).toHaveBeenCalledWith(WS, OWNER);
      expect(documentService.updateDocument).toHaveBeenCalled();
    });

    // A key carries its minter's authority as it stands now, not as it stood
    // at mint time: a demoted minter's key stops moving other people's
    // documents, and `assertMember` rejects a removed one outright.
    it('forbids an API key whose minter is no longer a manager', async () => {
      await expect(
        controller.update(WS, 'doc-1', req(MEMBER, true), { folderId: 'f-1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(documentService.updateDocument).not.toHaveBeenCalled();
    });

    it('renames and moves in one call', async () => {
      await controller.update(WS, 'doc-1', req(AUTHOR), {
        title: 'New',
        folderId: 'f-1',
      });
      expect(documentService.updateDocument).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: { title: 'New', folder: { connect: { id: 'f-1' } } },
      });
    });

    // The handler used to spread the whole request body into
    // `prisma.document.update`, so any column a caller named was writable.
    // `title` and `folderId` are now copied across one field at a time; these
    // two cases are what would fail if a later edit reintroduced the spread.
    //
    // They are the *handler's* half of the defence, and the reason it is worth
    // having on top of the DTO: calling a handler directly bypasses the global
    // `ValidationPipe` entirely, so nothing strips these keys here. The pipe's
    // half is covered over real HTTP in the suite below.
    it('drops unknown body fields instead of writing them', async () => {
      await controller.update(WS, 'doc-1', req(AUTHOR), {
        title: 'New',
        // Every one of these is a real `Document` column, and none of them
        // may be set through a rename.
        type: 'pdf',
        authorID: OWNER,
        workspaceId: 'ws-attacker',
        fileId: 'stolen-blob.pdf',
        id: 'doc-2',
      } as never);
      expect(documentService.updateDocument).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: { title: 'New' },
      });
    });

    it('writes nothing when the body carries only unknown fields', async () => {
      await controller.update(WS, 'doc-1', req(AUTHOR), {
        type: 'pdf',
        fileId: 'stolen-blob.pdf',
      } as never);
      expect(documentService.updateDocument).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: {},
      });
    });
  });
});

/**
 * Body validation, exercised over real HTTP so the global `ValidationPipe`
 * actually runs. Calling a handler directly (as the suite above does) bypasses
 * the pipe entirely, which is exactly how a mass-assignment hole survives a
 * green unit suite: the pipe only engages for a handler whose `@Body()`
 * parameter is a **DTO class**. Declared as an inline structural type
 * (`{ title?: string }`), TypeScript emits `Object` as the metatype, the pipe
 * skips it, and the raw JSON body reaches Prisma.
 */
describe('ApiV1DocumentsController body validation (global pipe)', () => {
  let app: INestApplication;
  let documentService: {
    getDocumentOrThrow: jest.Mock;
    updateDocument: jest.Mock;
    createDocument: jest.Mock;
    documents: jest.Mock;
    deleteDocument: jest.Mock;
  };

  const DOC = { id: 'doc-1', workspaceId: WS, authorID: AUTHOR, type: 'sheet' };

  /**
   * Writable keys of a Prisma `Document` update. A spread of the raw body into
   * `document.update` writes any of these; anything else makes Prisma throw,
   * which this backend (no exception filter) surfaces as a 500.
   *
   * `folder` is the relation the folder move goes through — the handler writes
   * `{ folder: { connect } }` / `{ folder: { disconnect } }` rather than the
   * `folderId` scalar — so it belongs here even though it is not a column.
   */
  const DOCUMENT_COLUMNS = new Set([
    'title',
    'type',
    'fileId',
    'fileSize',
    'mimeType',
    'folderId',
    'folder',
    'workspaceId',
    'updatedAt',
  ]);

  /**
   * A genuine v4 UUID. `folderId` is `@IsUUID()`, so `'f-1'` is a 400 — and
   * class-validator checks the RFC version and variant nibbles, not just the
   * 8-4-4-4-12 hex shape, so a hand-typed `1111...-3333-4444-...` fails too.
   * Prisma's `@default(uuid())` mints v4, so real folder ids pass.
   */
  const FOLDER = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

  beforeAll(async () => {
    documentService = {
      getDocumentOrThrow: jest.fn().mockResolvedValue(DOC),
      // Stands in for Prisma closely enough to reproduce both failure modes:
      // a real column is written, an unknown argument throws.
      updateDocument: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        for (const key of Object.keys(data)) {
          if (!DOCUMENT_COLUMNS.has(key)) {
            throw new Error(`Unknown argument \`${key}\``);
          }
        }
        return Promise.resolve({ ...DOC, ...data });
      }),
      createDocument: jest.fn((data: Record<string, unknown>) => {
        if (typeof data.title !== 'string' || data.title.length === 0) {
          throw new Error('Invalid value for argument `title`');
        }
        return Promise.resolve({ id: 'doc-new', ...data });
      }),
      documents: jest.fn().mockResolvedValue([]),
      deleteDocument: jest.fn(),
    };

    const allow = { canActivate: () => true };
    const moduleRef = await Test.createTestingModule({
      controllers: [ApiV1DocumentsController],
      providers: [
        { provide: DocumentService, useValue: documentService },
        { provide: YorkieAdminService, useValue: { getEditors: jest.fn() } },
        {
          provide: WorkspaceService,
          // The caller the auth guard below installs *is* `DOC.authorID`, so a
          // plain member role still clears `isDocumentManager` — these cases
          // are about the pipe, not about the gate (covered above).
          useValue: {
            assertMember: jest.fn().mockResolvedValue({ role: 'member' }),
          },
        },
        { provide: FileService, useValue: { delete: jest.fn() } },
        { provide: DocumentCopyService, useValue: { copy: jest.fn() } },
        {
          provide: FolderService,
          useValue: {
            assertSameWorkspace: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    })
      .overrideGuard(CombinedAuthGuard)
      .useValue({
        canActivate: (ctx: {
          switchToHttp: () => { getRequest: () => { user?: unknown } };
        }) => {
          ctx.switchToHttp().getRequest().user = {
            id: AUTHOR,
            isApiKey: false,
          };
          return true;
        },
      })
      .overrideGuard(WorkspaceScopeGuard)
      .useValue(allow)
      .overrideGuard(ApiKeyWriteScopeGuard)
      .useValue(allow)
      .compile();

    app = moduleRef.createNestApplication();
    // Mirrors `main.ts` exactly. Keep the two in sync — this suite is only
    // meaningful while it reproduces the deployed pipe configuration.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    documentService.updateDocument.mockClear();
    documentService.createDocument.mockClear();
  });

  const base = `/api/v1/workspaces/${WS}/documents`;
  const server = (): Server => app.getHttpServer() as Server;
  const updateData = (): Record<string, unknown> | undefined => {
    const call = documentService.updateDocument.mock.calls[0] as
      | [{ data: Record<string, unknown> }]
      | undefined;
    return call?.[0].data;
  };

  describe('PATCH :documentId', () => {
    it('accepts a rename and forwards only the title', async () => {
      const res = await request(server())
        .patch(`${base}/doc-1`)
        .send({ title: 'renamed' });
      expect(res.status).toBe(200);
      expect(updateData()).toEqual({ title: 'renamed' });
    });

    it('refuses to reroute which editor opens the document', async () => {
      const res = await request(server())
        .patch(`${base}/doc-1`)
        .send({ title: 'x', type: 'note' });
      expect(res.status).toBe(400);
      expect(updateData()?.type).toBeUndefined();
    });

    it('refuses to repoint the blob a document is backed by', async () => {
      const res = await request(server())
        .patch(`${base}/doc-1`)
        .send({ fileId: '11111111-2222-3333-4444-555555555555.pdf' });
      expect(res.status).toBe(400);
      expect(updateData()?.fileId).toBeUndefined();
    });

    it('refuses fileSize and mimeType', async () => {
      const res = await request(server())
        .patch(`${base}/doc-1`)
        .send({ fileSize: 1, mimeType: 'text/html' });
      expect(res.status).toBe(400);
    });

    it('rejects an unknown key with a 400, not a 500 from Prisma', async () => {
      const res = await request(server())
        .patch(`${base}/doc-1`)
        .send({ title: 'x', nope: 1 });
      expect(res.status).toBe(400);
      expect(documentService.updateDocument).not.toHaveBeenCalled();
    });

    it('rejects a non-string title', async () => {
      const res = await request(server())
        .patch(`${base}/doc-1`)
        .send({ title: 42 });
      expect(res.status).toBe(400);
    });

    // The folder move has to survive the DTO. `forbidNonWhitelisted` rejects
    // any key the class does not declare, so an `ApiV1UpdateDocumentDto`
    // without `folderId` would turn every move into a 400 — a green unit suite
    // (which never runs the pipe) would not notice.
    it('accepts a folder move and forwards the relation write', async () => {
      const res = await request(server())
        .patch(`${base}/doc-1`)
        .send({ folderId: FOLDER });
      expect(res.status).toBe(200);
      expect(updateData()).toEqual({ folder: { connect: { id: FOLDER } } });
    });

    // `null` is meaningful on this field — "move to the workspace root" — which
    // is why it is `@IsOptional()` (skipped for `null` as well as `undefined`)
    // rather than the `@ValidateIf(value !== undefined)` `title` uses.
    it('accepts an explicit null folderId as a move to the root', async () => {
      const res = await request(server())
        .patch(`${base}/doc-1`)
        .send({ folderId: null });
      expect(res.status).toBe(200);
      expect(updateData()).toEqual({ folder: { disconnect: true } });
    });

    it('accepts a rename and a folder move together', async () => {
      const res = await request(server())
        .patch(`${base}/doc-1`)
        .send({ title: 'renamed', folderId: FOLDER });
      expect(res.status).toBe(200);
      expect(updateData()).toEqual({
        title: 'renamed',
        folder: { connect: { id: FOLDER } },
      });
    });

    // Nullable must not decay into "anything goes": everything that is neither
    // a UUID string nor `null` is still a 400, and never reaches Prisma.
    it.each([
      ['a number', 42],
      ['an object', { id: FOLDER }],
      ['an array', [FOLDER]],
      ['a non-UUID string', 'f-1'],
      ['an empty string', ''],
    ])('rejects a folderId that is %s', async (_label, folderId) => {
      const res = await request(server())
        .patch(`${base}/doc-1`)
        .send({ folderId });
      expect(res.status).toBe(400);
      expect(documentService.updateDocument).not.toHaveBeenCalled();
    });
  });

  describe('POST (create)', () => {
    it('creates a sheet by default', async () => {
      const res = await request(server()).post(base).send({ title: 'new' });
      expect(res.status).toBe(201);
      expect(documentService.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'new', type: 'sheet' }),
      );
    });

    it('still accepts the CRDT types it always accepted', async () => {
      for (const type of ['doc', 'slides', 'note', 'board']) {
        documentService.createDocument.mockClear();
        const res = await request(server())
          .post(base)
          .send({ title: 't', type });
        expect(res.status).toBe(201);
        expect(documentService.createDocument).toHaveBeenCalledWith(
          expect.objectContaining({ type }),
        );
      }
    });

    it('still falls back to sheet for a type it never accepted', async () => {
      const res = await request(server())
        .post(base)
        .send({ title: 't', type: 'pdf' });
      expect(res.status).toBe(201);
      expect(documentService.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'sheet' }),
      );
    });

    it('rejects a missing title with a 400, not a 500 from Prisma', async () => {
      const res = await request(server()).post(base).send({});
      expect(res.status).toBe(400);
      expect(documentService.createDocument).not.toHaveBeenCalled();
    });

    it('rejects a non-string title', async () => {
      const res = await request(server())
        .post(base)
        .send({ title: { a: 1 } });
      expect(res.status).toBe(400);
    });

    it('rejects an unknown key rather than silently dropping it', async () => {
      const res = await request(server())
        .post(base)
        .send({ title: 't', fileId: 'x.pdf' });
      expect(res.status).toBe(400);
      expect(documentService.createDocument).not.toHaveBeenCalled();
    });
  });
});
