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
    controller = new ApiV1DocumentsController(
      documentService as never,
      { getEditors: jest.fn() } as never,
      workspaceService as never,
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

  it('allows a write-scoped API key without a membership check', async () => {
    await expect(
      controller.remove(WS, 'doc-1', req(0, true, ['read', 'write'])),
    ).resolves.toMatchObject({ id: 'doc-1' });
    expect(workspaceService.assertMember).not.toHaveBeenCalled();
  });

  it('forbids a read-only API key from deleting', async () => {
    await expect(
      controller.remove(WS, 'doc-1', req(0, true, ['read'])),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(documentService.deleteDocument).not.toHaveBeenCalled();
  });
});
