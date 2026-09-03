import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApiV1FoldersController } from './folders.controller';

const WS = 'ws-1';
const OTHER_WS = 'ws-2';
const AUTHOR = 1;
const OWNER = 2;
const MEMBER = 3;

describe('ApiV1FoldersController', () => {
  let controller: ApiV1FoldersController;
  let folderService: {
    getById: jest.Mock;
    listByWorkspace: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    assertNoCycle: jest.Mock;
    assertSameWorkspace: jest.Mock;
  };
  let workspaceService: { assertMember: jest.Mock };

  beforeEach(() => {
    folderService = {
      getById: jest
        .fn()
        .mockResolvedValue({ id: 'f-1', workspaceId: WS, authorID: AUTHOR }),
      listByWorkspace: jest.fn().mockResolvedValue([{ id: 'f-1' }]),
      create: jest.fn().mockResolvedValue({ id: 'f-new' }),
      update: jest.fn().mockResolvedValue({ id: 'f-1' }),
      delete: jest.fn().mockResolvedValue({ id: 'f-1' }),
      assertNoCycle: jest.fn().mockResolvedValue(undefined),
      assertSameWorkspace: jest.fn().mockResolvedValue(undefined),
    };
    workspaceService = {
      assertMember: jest.fn().mockResolvedValue({ role: 'member' }),
    };
    controller = new ApiV1FoldersController(
      folderService as never,
      workspaceService as never,
    );
  });

  const req = (userId: number, isApiKey = false) =>
    ({ user: { id: userId, isApiKey } }) as never;

  describe('create', () => {
    it('authors the folder as the caller and files it at the root by default', async () => {
      await controller.create(WS, req(MEMBER), { name: 'Q1' });
      expect(folderService.create).toHaveBeenCalledWith({
        name: 'Q1',
        workspaceId: WS,
        parentId: null,
        authorID: MEMBER,
      });
    });

    it('checks a supplied parent belongs to the route workspace', async () => {
      await controller.create(WS, req(MEMBER), { name: 'Q1', parentId: 'f-9' });
      expect(folderService.assertSameWorkspace).toHaveBeenCalledWith('f-9', WS);
    });

    it('authors an API key’s folder as the user who minted the key', async () => {
      await controller.create(WS, req(AUTHOR, true), { name: 'Q1' });
      expect(folderService.create).toHaveBeenCalledWith(
        expect.objectContaining({ authorID: AUTHOR }),
      );
    });
  });

  describe('list', () => {
    it('lists the route workspace only', async () => {
      await expect(controller.list(WS)).resolves.toEqual([{ id: 'f-1' }]);
      expect(folderService.listByWorkspace).toHaveBeenCalledWith(WS);
    });
  });

  // A folder in another workspace is a 404 rather than a 403: which folders a
  // workspace holds is that workspace's own information.
  describe('a folder outside the route workspace', () => {
    beforeEach(() => {
      folderService.getById.mockResolvedValue({
        id: 'f-1',
        workspaceId: OTHER_WS,
        authorID: AUTHOR,
      });
    });

    it('is not found on update', async () => {
      await expect(
        controller.update(WS, 'f-1', req(AUTHOR), { name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(folderService.update).not.toHaveBeenCalled();
    });

    it('is not found on delete', async () => {
      await expect(
        controller.remove(WS, 'f-1', req(AUTHOR)),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(folderService.delete).not.toHaveBeenCalled();
    });

    it('is not found even for a write-scoped API key', async () => {
      await expect(
        controller.remove(WS, 'f-1', req(AUTHOR, true)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('is not found when the folder does not exist at all', async () => {
    folderService.getById.mockResolvedValue(null);
    await expect(
      controller.remove(WS, 'f-1', req(AUTHOR)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('update', () => {
    it('lets any member rename a folder they do not own', async () => {
      await expect(
        controller.update(WS, 'f-1', req(MEMBER), { name: 'Renamed' }),
      ).resolves.toMatchObject({ id: 'f-1' });
      expect(folderService.update).toHaveBeenCalledWith('f-1', {
        name: 'Renamed',
      });
    });

    it('forbids a plain member from moving a folder they do not own', async () => {
      await expect(
        controller.update(WS, 'f-1', req(MEMBER), { parentId: 'f-2' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(folderService.update).not.toHaveBeenCalled();
    });

    it('lets the workspace owner move any folder', async () => {
      workspaceService.assertMember.mockResolvedValue({ role: 'owner' });
      await controller.update(WS, 'f-1', req(OWNER), { parentId: 'f-2' });
      expect(folderService.update).toHaveBeenCalledWith('f-1', {
        parentId: 'f-2',
      });
    });

    it('lets the folder author move their own folder', async () => {
      await controller.update(WS, 'f-1', req(AUTHOR), { parentId: 'f-2' });
      expect(folderService.update).toHaveBeenCalledWith('f-1', {
        parentId: 'f-2',
      });
    });

    it('treats an explicit null parent as a move to the workspace root', async () => {
      await controller.update(WS, 'f-1', req(AUTHOR), { parentId: null });
      expect(folderService.assertSameWorkspace).not.toHaveBeenCalled();
      expect(folderService.assertNoCycle).toHaveBeenCalledWith('f-1', null);
      expect(folderService.update).toHaveBeenCalledWith('f-1', {
        parentId: null,
      });
    });

    it('checks the new parent for workspace and cycles before writing', async () => {
      folderService.assertNoCycle.mockRejectedValue(new Error('cycle'));
      await expect(
        controller.update(WS, 'f-1', req(AUTHOR), { parentId: 'f-2' }),
      ).rejects.toThrow('cycle');
      expect(folderService.assertSameWorkspace).toHaveBeenCalledWith('f-2', WS);
      expect(folderService.update).not.toHaveBeenCalled();
    });

    it('allows a write-scoped API key to move without a membership check', async () => {
      await controller.update(WS, 'f-1', req(0, true), { parentId: 'f-2' });
      expect(workspaceService.assertMember).not.toHaveBeenCalled();
      expect(folderService.update).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('forbids a plain member from deleting a folder they do not own', async () => {
      await expect(
        controller.remove(WS, 'f-1', req(MEMBER)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(folderService.delete).not.toHaveBeenCalled();
    });

    it('lets the workspace owner delete any folder', async () => {
      workspaceService.assertMember.mockResolvedValue({ role: 'owner' });
      await expect(
        controller.remove(WS, 'f-1', req(OWNER)),
      ).resolves.toMatchObject({ id: 'f-1' });
    });

    it('allows a write-scoped API key without a membership check', async () => {
      await expect(
        controller.remove(WS, 'f-1', req(0, true)),
      ).resolves.toMatchObject({ id: 'f-1' });
      expect(workspaceService.assertMember).not.toHaveBeenCalled();
    });
  });
});
