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
    const workspaceService = { assertMember: jest.fn().mockResolvedValue({}) };
    return new DocumentController(
      documentService as never,
      workspaceService as never,
      { getSummaries: jest.fn() } as never,
      { getObject: jest.fn() } as never,
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
});

const WS = 'ws-1';
const AUTHOR = 1;
const OWNER = 2;
const MEMBER = 3;

function reqAs(userId: number) {
  return { user: { id: userId } } as never;
}

describe('DocumentController delete/move/rename permissions', () => {
  let controller: DocumentController;
  let documentService: {
    document: jest.Mock;
    deleteDocument: jest.Mock;
    updateDocument: jest.Mock;
    listDocumentsWithAuthor: jest.Mock;
  };
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
      deleteDocument: jest.fn().mockResolvedValue({ id: 'doc-1' }),
      updateDocument: jest.fn().mockResolvedValue({ id: 'doc-1' }),
      listDocumentsWithAuthor: jest.fn(),
    };
    workspaceService = {
      // Default: caller is a plain member. Individual tests override the role.
      assertMember: jest.fn().mockResolvedValue({ role: 'member' }),
      findMembershipsByUser: jest.fn(),
      resolveId: jest.fn((id: string) => Promise.resolve(id)),
    };
    controller = new DocumentController(
      documentService as never,
      workspaceService as never,
      { getEditors: jest.fn().mockResolvedValue(new Map()) } as never,
      { delete: jest.fn().mockResolvedValue(undefined) } as never,
    );
  });

  describe('deleteDocument', () => {
    it('forbids a plain member from deleting a document they do not own', async () => {
      workspaceService.assertMember.mockResolvedValue({ role: 'member' });
      await expect(
        controller.deleteDocument(reqAs(MEMBER), 'doc-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(documentService.deleteDocument).not.toHaveBeenCalled();
    });

    it('lets the workspace owner delete any document', async () => {
      workspaceService.assertMember.mockResolvedValue({ role: 'owner' });
      await expect(
        controller.deleteDocument(reqAs(OWNER), 'doc-1'),
      ).resolves.toMatchObject({ id: 'doc-1' });
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
      expect(documentService.updateDocument).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
        data: { workspace: { connect: { id: 'ws-2' } } },
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
