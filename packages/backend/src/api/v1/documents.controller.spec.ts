import { ForbiddenException } from '@nestjs/common';
import { ApiV1DocumentsController } from './documents.controller';

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
  });
});
