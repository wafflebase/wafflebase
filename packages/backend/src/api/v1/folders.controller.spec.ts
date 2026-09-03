import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApiV1FoldersController } from './folders.controller';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ApiKeyWriteScopeGuard } from './api-key-write-scope.guard';

// `list` and `create` trust the route `workspaceId` outright — they have no
// membership or key-scope check of their own, deliberately, because the
// class-level guards run first. That makes the mounting itself the security
// boundary: drop `WorkspaceScopeGuard` and an API key minted for one
// workspace lists and writes folders in another. These tests instantiate the
// controller directly, so no guard ever executes here; assert the metadata.
describe('ApiV1FoldersController guards', () => {
  const guards: unknown[] =
    (Reflect.getMetadata(
      '__guards__',
      ApiV1FoldersController,
    ) as unknown[]) ?? [];

  it.each([
    ['CombinedAuthGuard', CombinedAuthGuard],
    ['WorkspaceScopeGuard', WorkspaceScopeGuard],
    ['ApiKeyWriteScopeGuard', ApiKeyWriteScopeGuard],
  ])('mounts %s at the class level', (_name, guard) => {
    expect(guards).toContain(guard);
  });

  // Authentication has to resolve `req.user` before the scope guard reads it,
  // and the scope guard rewrites `params.workspaceId` from a slug to a uuid
  // before any handler sees it.
  it('authenticates before it scopes', () => {
    expect(guards.indexOf(CombinedAuthGuard)).toBeLessThan(
      guards.indexOf(WorkspaceScopeGuard),
    );
  });
});

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

    it('lets an API key minted by an owner move any folder', async () => {
      workspaceService.assertMember.mockResolvedValue({ role: 'owner' });
      await controller.update(WS, 'f-1', req(OWNER, true), { parentId: 'f-2' });
      expect(workspaceService.assertMember).toHaveBeenCalledWith(WS, OWNER);
      expect(folderService.update).toHaveBeenCalled();
    });

    // A key carries its minter's authority as it stands now, not as it stood
    // at mint time — a demoted minter's key stops managing other people's
    // folders, and `assertMember` rejects a removed one outright.
    it('forbids an API key whose minter is no longer a manager', async () => {
      await expect(
        controller.update(WS, 'f-1', req(MEMBER, true), { parentId: 'f-2' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(folderService.update).not.toHaveBeenCalled();
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

    it('lets an API key minted by an owner delete any folder', async () => {
      workspaceService.assertMember.mockResolvedValue({ role: 'owner' });
      await expect(
        controller.remove(WS, 'f-1', req(OWNER, true)),
      ).resolves.toMatchObject({ id: 'f-1' });
      expect(workspaceService.assertMember).toHaveBeenCalledWith(WS, OWNER);
    });

    it('forbids an API key whose minter is no longer a manager', async () => {
      await expect(
        controller.remove(WS, 'f-1', req(MEMBER, true)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(folderService.delete).not.toHaveBeenCalled();
    });

    it('refuses an API key whose minter left the workspace', async () => {
      workspaceService.assertMember.mockRejectedValue(
        new ForbiddenException('Not a member of this workspace'),
      );
      await expect(
        controller.remove(WS, 'f-1', req(OWNER, true)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(folderService.delete).not.toHaveBeenCalled();
    });
  });
});
