import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DocumentController } from './document.controller';

const req = { user: { id: '1' } } as never;

describe('DocumentController.createDocument fileId gating', () => {
  function makeController(createDocument: jest.Mock) {
    const documentService = { createDocument };
    const copyService = { copy: jest.fn() };
    const workspaceService = { assertMember: jest.fn().mockResolvedValue({}) };
    return new DocumentController(
      documentService as never,
      copyService as never,
      workspaceService as never,
      { getSummaries: jest.fn() } as never,
      { getObject: jest.fn() } as never,
      { assertSameWorkspace: jest.fn() } as never,
    );
  }

  it('rejects a fileId on a non-pdf document', async () => {
    const createDocument = jest.fn();
    const ctrl = makeController(createDocument);
    await expect(
      ctrl.createDocument(req, {
        title: 'Sheet',
        type: 'doc',
        fileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf',
        workspaceId: 'w1',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('rejects a fileId when type defaults to sheet', async () => {
    const createDocument = jest.fn();
    const ctrl = makeController(createDocument);
    await expect(
      ctrl.createDocument(req, {
        title: 'Sheet',
        fileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf',
        workspaceId: 'w1',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createDocument).not.toHaveBeenCalled();
  });

  it('allows a fileId on a pdf document', async () => {
    const createDocument = jest.fn().mockResolvedValue({ id: 'd1' });
    const ctrl = makeController(createDocument);
    await ctrl.createDocument(req, {
      title: 'Doc.pdf',
      type: 'pdf',
      fileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf',
      workspaceId: 'w1',
    } as never);
    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'pdf',
        fileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf',
      }),
    );
  });

  it('forwards fileSize/mimeType when a fileId is present', async () => {
    const createDocument = jest.fn().mockResolvedValue({ id: 'd1' });
    const ctrl = makeController(createDocument);
    await ctrl.createDocument(req, {
      title: 'Doc.pdf',
      type: 'pdf',
      fileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf',
      fileSize: 1234,
      mimeType: 'application/pdf',
      workspaceId: 'w1',
    } as never);
    expect(createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        fileSize: 1234,
        mimeType: 'application/pdf',
      }),
    );
  });

  it('drops fileSize/mimeType when no fileId is present, even if supplied', async () => {
    const createDocument = jest.fn().mockResolvedValue({ id: 'd1' });
    const ctrl = makeController(createDocument);
    await ctrl.createDocument(req, {
      title: 'Sheet',
      // No fileId — a CRDT document must never carry blob metadata.
      fileSize: 1234,
      mimeType: 'application/pdf',
      workspaceId: 'w1',
    } as never);
    expect(createDocument).toHaveBeenCalledTimes(1);
    const call = createDocument.mock.calls[0][0];
    expect(call).not.toHaveProperty('fileSize');
    expect(call).not.toHaveProperty('mimeType');
  });
});

describe('DocumentController.createInWorkspace blob metadata forwarding', () => {
  function makeWorkspaceController(createDocument: jest.Mock) {
    const documentService = { createDocument };
    const copyService = { copy: jest.fn() };
    const workspaceService = {
      assertMember: jest.fn().mockResolvedValue({}),
      resolveId: jest.fn((id: string) => Promise.resolve(id)),
    };
    return new DocumentController(
      documentService as never,
      copyService as never,
      workspaceService as never,
      { getSummaries: jest.fn() } as never,
      { getObject: jest.fn() } as never,
      { assertSameWorkspace: jest.fn() } as never,
    );
  }

  it('forwards fileSize/mimeType when a fileId is present', async () => {
    const createDocument = jest.fn().mockResolvedValue({ id: 'd1' });
    const ctrl = makeWorkspaceController(createDocument);
    await ctrl.createInWorkspace('w1', req, {
      title: 'Doc.pdf',
      type: 'pdf',
      fileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf',
      fileSize: 5678,
      mimeType: 'application/pdf',
    } as never);
    expect(createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        fileSize: 5678,
        mimeType: 'application/pdf',
      }),
    );
  });

  it('drops fileSize/mimeType when no fileId is present, even if supplied', async () => {
    const createDocument = jest.fn().mockResolvedValue({ id: 'd1' });
    const ctrl = makeWorkspaceController(createDocument);
    await ctrl.createInWorkspace('w1', req, {
      title: 'Sheet',
      fileSize: 5678,
      mimeType: 'application/pdf',
    } as never);
    expect(createDocument).toHaveBeenCalledTimes(1);
    const call = createDocument.mock.calls[0][0];
    expect(call).not.toHaveProperty('fileSize');
    expect(call).not.toHaveProperty('mimeType');
  });
});

const WS = 'ws-1';
const AUTHOR = 1;
const OWNER = 2;
const MEMBER = 3;
const TRASHED_AT = new Date('2026-11-14T00:00:00Z');
const BLOB_ID = '11111111-2222-3333-4444-555555555555.pdf';

function reqAs(userId: number) {
  return { user: { id: userId } } as never;
}

describe('DocumentController delete/move/rename permissions', () => {
  let controller: DocumentController;
  let documentService: {
    document: jest.Mock;
    documentIncludingTrashed: jest.Mock;
    trashDocuments: jest.Mock;
    restoreDocument: jest.Mock;
    trashedDocument: jest.Mock;
    purgeTrashedDocument: jest.Mock;
    deleteDocument: jest.Mock;
    updateDocument: jest.Mock;
    listDocumentsWithAuthor: jest.Mock;
    listTrash: jest.Mock;
  };
  let fileService: { delete: jest.Mock };
  let copyService: { copy: jest.Mock };
  let workspaceService: {
    assertMember: jest.Mock;
    findMembershipsByUser: jest.Mock;
    resolveId: jest.Mock;
  };

  beforeEach(() => {
    documentService = {
      document: jest.fn().mockResolvedValue({
        id: 'doc-1',
        workspaceId: WS,
        authorID: AUTHOR,
        fileId: null,
      }),
      documentIncludingTrashed: jest.fn().mockResolvedValue({
        id: 'doc-1',
        workspaceId: WS,
        authorID: AUTHOR,
        fileId: null,
        deletedAt: TRASHED_AT,
      }),
      trashDocuments: jest.fn().mockResolvedValue(1),
      restoreDocument: jest.fn().mockResolvedValue({
        id: 'doc-1',
        workspaceId: WS,
        authorID: AUTHOR,
        deletedAt: null,
      }),
      trashedDocument: jest.fn().mockResolvedValue({
        id: 'doc-1',
        workspaceId: WS,
        authorID: AUTHOR,
        fileId: null,
        deletedAt: TRASHED_AT,
      }),
      purgeTrashedDocument: jest.fn().mockResolvedValue(true),
      deleteDocument: jest.fn().mockResolvedValue({ id: 'doc-1' }),
      updateDocument: jest.fn().mockResolvedValue({ id: 'doc-1' }),
      listDocumentsWithAuthor: jest.fn(),
      listTrash: jest.fn(),
    };
    fileService = { delete: jest.fn().mockResolvedValue(undefined) };
    copyService = { copy: jest.fn() };
    workspaceService = {
      // Default: caller is a plain member. Individual tests override the role.
      assertMember: jest.fn().mockResolvedValue({ role: 'member' }),
      findMembershipsByUser: jest.fn(),
      resolveId: jest.fn((id: string) => Promise.resolve(id)),
    };
    controller = new DocumentController(
      documentService as never,
      copyService as never,
      workspaceService as never,
      { getEditors: jest.fn().mockResolvedValue(new Map()) } as never,
      fileService as never,
      { assertSameWorkspace: jest.fn() } as never,
    );
  });

  describe('deleteDocument', () => {
    it('forbids a plain member from deleting a document they do not own', async () => {
      workspaceService.assertMember.mockResolvedValue({ role: 'member' });
      await expect(
        controller.deleteDocument(reqAs(MEMBER), 'doc-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(documentService.purgeTrashedDocument).not.toHaveBeenCalled();
      expect(documentService.trashDocuments).not.toHaveBeenCalled();
    });

    it('lets the workspace owner move any document to the trash', async () => {
      workspaceService.assertMember.mockResolvedValue({ role: 'owner' });
      await expect(
        controller.deleteDocument(reqAs(OWNER), 'doc-1'),
      ).resolves.toMatchObject({ id: 'doc-1', deletedAt: TRASHED_AT });
      expect(documentService.trashDocuments).toHaveBeenCalledWith(['doc-1']);
      // A soft delete keeps the row and its blob.
      expect(documentService.purgeTrashedDocument).not.toHaveBeenCalled();
      expect(fileService.delete).not.toHaveBeenCalled();
    });

    it('deletes for good, blob included, with ?permanent=true', async () => {
      workspaceService.assertMember.mockResolvedValue({ role: 'owner' });
      documentService.trashedDocument.mockResolvedValue({
        id: 'doc-1',
        workspaceId: WS,
        authorID: AUTHOR,
        fileId: BLOB_ID,
        deletedAt: TRASHED_AT,
      });
      await controller.deleteDocument(reqAs(OWNER), 'doc-1', 'true');
      expect(documentService.trashedDocument).toHaveBeenCalledWith({
        id: 'doc-1',
      });
      expect(documentService.purgeTrashedDocument).toHaveBeenCalledWith(
        'doc-1',
      );
      expect(documentService.trashDocuments).not.toHaveBeenCalled();
      expect(fileService.delete).toHaveBeenCalledWith(BLOB_ID);
    });

    it('holds a permanent delete to the same manager gate', async () => {
      workspaceService.assertMember.mockResolvedValue({ role: 'member' });
      await expect(
        controller.deleteDocument(reqAs(MEMBER), 'doc-1', 'true'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(documentService.purgeTrashedDocument).not.toHaveBeenCalled();
    });

    // A stale Trash page must not destroy a document a collaborator restored
    // after it loaded: a permanent delete only reaches the trash.
    it('answers 404 for a permanent delete of a live document', async () => {
      workspaceService.assertMember.mockResolvedValue({ role: 'owner' });
      documentService.trashedDocument.mockResolvedValue(null);
      await expect(
        controller.deleteDocument(reqAs(OWNER), 'doc-1', 'true'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(documentService.purgeTrashedDocument).not.toHaveBeenCalled();
      expect(documentService.deleteDocument).not.toHaveBeenCalled();
      expect(fileService.delete).not.toHaveBeenCalled();
    });

    it('keeps the blob when a restore wins the race to the delete', async () => {
      workspaceService.assertMember.mockResolvedValue({ role: 'owner' });
      documentService.trashedDocument.mockResolvedValue({
        id: 'doc-1',
        workspaceId: WS,
        authorID: AUTHOR,
        fileId: BLOB_ID,
        deletedAt: TRASHED_AT,
      });
      documentService.purgeTrashedDocument.mockResolvedValue(false);
      await expect(
        controller.deleteDocument(reqAs(OWNER), 'doc-1', 'true'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(fileService.delete).not.toHaveBeenCalled();
    });

    it('answers 404 when trashing a document already in the trash', async () => {
      // `document()` is live-only, so a trashed row reads as missing.
      documentService.document.mockResolvedValue(null);
      await expect(
        controller.deleteDocument(reqAs(OWNER), 'doc-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(documentService.trashDocuments).not.toHaveBeenCalled();
    });

    it('lets the document author delete their own document', async () => {
      workspaceService.assertMember.mockResolvedValue({ role: 'member' });
      await expect(
        controller.deleteDocument(reqAs(AUTHOR), 'doc-1'),
      ).resolves.toMatchObject({ id: 'doc-1' });
    });

    it('propagates the 403 when the caller is not a member', async () => {
      workspaceService.assertMember.mockRejectedValue(new ForbiddenException());
      await expect(
        controller.deleteDocument(reqAs(999), 'doc-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws NotFound for a missing document', async () => {
      documentService.document.mockResolvedValue(null);
      await expect(
        controller.deleteDocument(reqAs(OWNER), 'doc-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('restoreDocument', () => {
    it('restores a trashed document for its author', async () => {
      await expect(
        controller.restoreDocument(reqAs(AUTHOR), 'doc-1'),
      ).resolves.toMatchObject({ id: 'doc-1', deletedAt: null });
      expect(documentService.restoreDocument).toHaveBeenCalledWith('doc-1');
    });

    it('forbids a plain member who does not own it', async () => {
      await expect(
        controller.restoreDocument(reqAs(MEMBER), 'doc-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(documentService.restoreDocument).not.toHaveBeenCalled();
    });

    it('answers 404 for a live document', async () => {
      documentService.documentIncludingTrashed.mockResolvedValue({
        id: 'doc-1',
        workspaceId: WS,
        authorID: AUTHOR,
        deletedAt: null,
      });
      await expect(
        controller.restoreDocument(reqAs(AUTHOR), 'doc-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('answers 404 when the restore loses a race', async () => {
      documentService.restoreDocument.mockResolvedValue(null);
      await expect(
        controller.restoreDocument(reqAs(AUTHOR), 'doc-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findTrashByWorkspace', () => {
    const trashedRow = (id: string, authorID: number) => ({
      id,
      type: 'sheet',
      workspaceId: WS,
      authorID,
      updatedAt: new Date(0),
      deletedAt: TRASHED_AT,
    });

    it('lists trashed rows with canManage and an ISO deletedAt', async () => {
      documentService.listTrash.mockResolvedValue([
        trashedRow('a', AUTHOR),
        trashedRow('b', 999),
      ]);
      const rows = await controller.findTrashByWorkspace(WS, reqAs(AUTHOR));
      expect(documentService.listTrash).toHaveBeenCalledWith(WS);
      expect(rows.map((r) => [r.id, r.canManage, r.deletedAt])).toEqual([
        ['a', true, TRASHED_AT.toISOString()],
        ['b', false, TRASHED_AT.toISOString()],
      ]);
    });

    it('is member-gated', async () => {
      workspaceService.assertMember.mockRejectedValue(new ForbiddenException());
      await expect(
        controller.findTrashByWorkspace(WS, reqAs(999)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(documentService.listTrash).not.toHaveBeenCalled();
    });
  });

  describe('updateDocument', () => {
    it('lets a plain member rename a document', async () => {
      workspaceService.assertMember.mockResolvedValue({ role: 'member' });
      await controller.updateDocument(reqAs(MEMBER), 'doc-1', {
        title: 'Renamed',
      } as never);
      expect(documentService.updateDocument).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: { title: 'Renamed' },
      });
    });

    it('forbids a plain member from moving a document', async () => {
      workspaceService.assertMember.mockResolvedValue({ role: 'member' });
      await expect(
        controller.updateDocument(reqAs(MEMBER), 'doc-1', {
          workspaceId: 'ws-2',
        } as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(documentService.updateDocument).not.toHaveBeenCalled();
    });

    it('lets the owner move a document (checking destination membership)', async () => {
      workspaceService.assertMember.mockResolvedValue({ role: 'owner' });
      await controller.updateDocument(reqAs(OWNER), 'doc-1', {
        workspaceId: 'ws-2',
      } as never);
      expect(workspaceService.assertMember).toHaveBeenCalledWith(WS, OWNER);
      expect(workspaceService.assertMember).toHaveBeenCalledWith('ws-2', OWNER);
      // Moving across workspaces with no explicit folderId also drops the
      // folder, since the old folder belongs to the source workspace.
      expect(documentService.updateDocument).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: {
          workspace: { connect: { id: 'ws-2' } },
          folder: { disconnect: true },
        },
      });
    });
  });

  describe('getDocuments (canManage annotation)', () => {
    it('flags canManage per row from workspace role and authorship', async () => {
      documentService.listDocumentsWithAuthor.mockResolvedValue([
        { id: 'a', type: 'sheet', workspaceId: WS, authorID: AUTHOR, updatedAt: new Date(0) },
        { id: 'b', type: 'sheet', workspaceId: WS, authorID: 999, updatedAt: new Date(0) },
        { id: 'c', type: 'sheet', workspaceId: 'ws-owned', authorID: 999, updatedAt: new Date(0) },
      ]);
      workspaceService.findMembershipsByUser.mockResolvedValue([
        { workspaceId: WS, role: 'member' },
        { workspaceId: 'ws-owned', role: 'owner' },
      ]);

      const rows = await controller.getDocuments(reqAs(AUTHOR));
      const byId = Object.fromEntries(rows.map((r) => [r.id, r.canManage]));
      // a: authored by caller → manage; b: member, not author → no; c: owner → manage.
      expect(byId).toEqual({ a: true, b: false, c: true });
    });
  });
});

describe('DocumentController.moveDocuments', () => {
  function makeMoveController(overrides: {
    docs?: Record<string, any>;
    memberRole?: string; // role for assertMember
  }) {
    const docs = overrides.docs ?? {};
    const documentService = {
      document: jest.fn(async ({ id }: { id: string }) => docs[id] ?? null),
      moveDocuments: jest.fn(async () => Object.keys(docs).length),
      deleteDocuments: jest.fn(async () => 0),
      deleteDocument: jest.fn(),
    };
    const copyService = { copy: jest.fn() };
    const workspaceService = {
      assertMember: jest.fn(async () => ({
        role: overrides.memberRole ?? 'owner',
      })),
    };
    const folderService = { assertSameWorkspace: jest.fn(async () => undefined) };
    const controller = new DocumentController(
      documentService as never,
      copyService as never,
      workspaceService as never,
      {} as never,
      { delete: jest.fn() } as never,
      folderService as never,
    );
    return { controller, documentService, workspaceService, folderService };
  }

  it('rejects an empty id list', async () => {
    const { controller } = makeMoveController({});
    await expect(
      controller.moveDocuments(reqAs(1), { ids: [] } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('moves all documents into a folder in one call', async () => {
    const { controller, documentService, folderService } = makeMoveController({
      docs: {
        a: { id: 'a', workspaceId: 'ws1', authorID: 1 },
        b: { id: 'b', workspaceId: 'ws1', authorID: 1 },
      },
    });
    const res = await controller.moveDocuments(reqAs(1), {
      ids: ['a', 'b'],
      folderId: 'fld1',
    } as never);
    expect(res).toEqual({ moved: ['a', 'b'] });
    expect(folderService.assertSameWorkspace).toHaveBeenCalledWith(
      'fld1',
      'ws1',
    );
    expect(documentService.moveDocuments).toHaveBeenCalledWith([
      { id: 'a', data: { folder: { connect: { id: 'fld1' } } } },
      { id: 'b', data: { folder: { connect: { id: 'fld1' } } } },
    ]);
  });

  it('rejects atomically when one id is not managed by the caller', async () => {
    const { controller, documentService } = makeMoveController({
      docs: {
        a: { id: 'a', workspaceId: 'ws1', authorID: 1 },
        b: { id: 'b', workspaceId: 'ws1', authorID: 999 }, // not author
      },
      memberRole: 'member', // not owner → not manager of b
    });
    await expect(
      controller.moveDocuments(reqAs(1), {
        ids: ['a', 'b'],
        folderId: 'fld1',
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(documentService.moveDocuments).not.toHaveBeenCalled();
  });

  it('moves folderId:null to workspace root (disconnect)', async () => {
    const { controller, documentService } = makeMoveController({
      docs: { a: { id: 'a', workspaceId: 'ws1', authorID: 1 } },
    });
    await controller.moveDocuments(reqAs(1), {
      ids: ['a'],
      folderId: null,
    } as never);
    expect(documentService.moveDocuments).toHaveBeenCalledWith([
      { id: 'a', data: { folder: { disconnect: true } } },
    ]);
  });
});

describe('DocumentController.deleteDocuments', () => {
  function makeDeleteController(overrides: {
    docs?: Record<string, any>;
    trashed?: Record<string, any>;
    restoredMidway?: string[];
    memberRole?: string; // role for assertMember
  }) {
    const docs = overrides.docs ?? {};
    const trashed = overrides.trashed ?? {};
    const documentService = {
      document: jest.fn(async ({ id }: { id: string }) => docs[id] ?? null),
      documentIncludingTrashed: jest.fn(({ id }: { id: string }) =>
        Promise.resolve(docs[id] ?? trashed[id] ?? null),
      ),
      trashedDocument: jest.fn(({ id }: { id: string }) =>
        Promise.resolve(trashed[id] ?? null),
      ),
      moveDocuments: jest.fn(),
      trashDocuments: jest.fn((ids: string[]) => Promise.resolve(ids.length)),
      // Purges what is still in the trash at write time; `restoredMidway`
      // simulates a collaborator's restore landing after the gate read.
      purgeTrashedDocuments: jest.fn((ids: string[]) =>
        Promise.resolve(
          ids.filter(
            (id) => trashed[id] && !overrides.restoredMidway?.includes(id),
          ),
        ),
      ),
      deleteDocument: jest.fn(),
    };
    const copyService = { copy: jest.fn() };
    const workspaceService = {
      assertMember: jest.fn(async () => ({
        role: overrides.memberRole ?? 'owner',
      })),
    };
    const fileService = { delete: jest.fn(async () => undefined) };
    const controller = new DocumentController(
      documentService as never,
      copyService as never,
      workspaceService as never,
      {} as never,
      fileService as never,
      { assertSameWorkspace: jest.fn() } as never,
    );
    return { controller, documentService, workspaceService, fileService };
  }

  it('trashes all when the caller manages every id', async () => {
    const { controller, documentService, fileService } = makeDeleteController({
      docs: {
        a: { id: 'a', workspaceId: 'ws1', authorID: 1, fileId: BLOB_ID },
        b: { id: 'b', workspaceId: 'ws1', authorID: 1, fileId: null },
      },
    });
    const res = await controller.deleteDocuments(reqAs(1), {
      ids: ['a', 'b'],
    } as never);
    expect(res).toEqual({ deleted: ['a', 'b'] });
    expect(documentService.trashDocuments).toHaveBeenCalledWith(['a', 'b']);
    expect(documentService.purgeTrashedDocuments).not.toHaveBeenCalled();
    expect(fileService.delete).not.toHaveBeenCalled();
  });

  it('deletes trashed ids for good with permanent: true', async () => {
    const { controller, documentService, fileService } = makeDeleteController({
      trashed: {
        a: {
          id: 'a',
          workspaceId: 'ws1',
          authorID: 1,
          fileId: null,
          deletedAt: TRASHED_AT,
        },
        b: {
          id: 'b',
          workspaceId: 'ws1',
          authorID: 1,
          fileId: BLOB_ID,
          deletedAt: TRASHED_AT,
        },
      },
    });
    const res = await controller.deleteDocuments(reqAs(1), {
      ids: ['a', 'b'],
      permanent: true,
    });
    expect(res).toEqual({ deleted: ['a', 'b'] });
    expect(documentService.purgeTrashedDocuments).toHaveBeenCalledWith([
      'a',
      'b',
    ]);
    expect(documentService.trashDocuments).not.toHaveBeenCalled();
    expect(fileService.delete).toHaveBeenCalledWith(BLOB_ID);
  });

  // Empty trash from a stale page: `a` is live again, so the whole request is
  // refused before anything is destroyed.
  it('refuses a permanent delete that names a live id', async () => {
    const { controller, documentService, fileService } = makeDeleteController({
      docs: {
        a: { id: 'a', workspaceId: 'ws1', authorID: 1, fileId: BLOB_ID },
      },
      trashed: {
        b: { id: 'b', workspaceId: 'ws1', authorID: 1, deletedAt: TRASHED_AT },
      },
    });
    await expect(
      controller.deleteDocuments(reqAs(1), {
        ids: ['a', 'b'],
        permanent: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(documentService.purgeTrashedDocuments).not.toHaveBeenCalled();
    expect(fileService.delete).not.toHaveBeenCalled();
  });

  it('spares an id restored after the gate, blob included', async () => {
    const { controller, fileService } = makeDeleteController({
      trashed: {
        a: {
          id: 'a',
          workspaceId: 'ws1',
          authorID: 1,
          fileId: BLOB_ID,
          deletedAt: TRASHED_AT,
        },
        b: { id: 'b', workspaceId: 'ws1', authorID: 1, deletedAt: TRASHED_AT },
      },
      restoredMidway: ['a'],
    });
    const res = await controller.deleteDocuments(reqAs(1), {
      ids: ['a', 'b'],
      permanent: true,
    });
    expect(res).toEqual({ deleted: ['b'] });
    expect(fileService.delete).not.toHaveBeenCalled();
  });

  it('refuses to trash an id that is already in the trash', async () => {
    const { controller, documentService } = makeDeleteController({
      docs: { a: { id: 'a', workspaceId: 'ws1', authorID: 1 } },
      trashed: { b: { id: 'b', workspaceId: 'ws1', authorID: 1 } },
    });
    await expect(
      controller.deleteDocuments(reqAs(1), { ids: ['a', 'b'] } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(documentService.trashDocuments).not.toHaveBeenCalled();
  });

  it('rejects atomically when one id is not managed', async () => {
    const { controller, documentService } = makeDeleteController({
      docs: {
        a: { id: 'a', workspaceId: 'ws1', authorID: 1 },
        b: { id: 'b', workspaceId: 'ws1', authorID: 999 },
      },
      memberRole: 'member',
    });
    await expect(
      controller.deleteDocuments(reqAs(1), { ids: ['a', 'b'] } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(documentService.trashDocuments).not.toHaveBeenCalled();
  });
});

describe('DocumentController.copyDocument', () => {
  function makeCopyController(doc: unknown, role = 'member') {
    const documentService = { document: jest.fn(async () => doc) };
    const copyService = {
      copy: jest.fn(async () => ({ id: 'copy-1', title: 'Report (copy)' })),
    };
    const workspaceService = {
      assertMember: jest.fn(async () => ({ role })),
    };
    const controller = new DocumentController(
      documentService as never,
      copyService as never,
      workspaceService as never,
      {} as never,
      { delete: jest.fn() } as never,
      { assertSameWorkspace: jest.fn() } as never,
    );
    return { controller, documentService, copyService, workspaceService };
  }

  it('404s an unknown document', async () => {
    const { controller, copyService } = makeCopyController(null);
    await expect(
      controller.copyDocument(reqAs(MEMBER), 'nope'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(copyService.copy).not.toHaveBeenCalled();
  });

  // The whole point of the copy gate: a plain member who owns nothing may
  // still duplicate a document they can read, because the source is untouched.
  it('lets a plain member copy a document they do not own', async () => {
    const source = {
      id: 'doc-1',
      title: 'Report',
      workspaceId: WS,
      authorID: AUTHOR,
    };
    const { controller, copyService, workspaceService } = makeCopyController(
      source,
    );
    await expect(
      controller.copyDocument(reqAs(MEMBER), 'doc-1'),
    ).resolves.toMatchObject({ id: 'copy-1' });
    expect(workspaceService.assertMember).toHaveBeenCalledWith(WS, MEMBER);
    // The copier — not the source's author — owns the copy.
    expect(copyService.copy).toHaveBeenCalledWith(source, MEMBER);
  });
});
