import {
  ForbiddenException,
  NotFoundException,
  GoneException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { WorkspaceService } from './workspace.service';

function createMockPrisma() {
  return {
    workspace: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    workspaceMember: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    workspaceInvite: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
    },
  };
}

describe('WorkspaceService', () => {
  let service: WorkspaceService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new WorkspaceService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('create', () => {
    it('creates a workspace and adds the creator as owner', async () => {
      const workspace = { id: 'ws-1', name: 'My Workspace' };
      prisma.workspace.create.mockResolvedValue(workspace);
      prisma.workspaceMember.create.mockResolvedValue({});

      const result = await service.create(1, { name: 'My Workspace' });

      expect(result).toEqual(workspace);
      expect(prisma.workspace.create).toHaveBeenCalledWith({
        data: { name: 'My Workspace' },
      });
      expect(prisma.workspaceMember.create).toHaveBeenCalledWith({
        data: { workspaceId: 'ws-1', userId: 1, role: 'owner' },
      });
    });
  });

  describe('findAllByUser', () => {
    it('returns workspaces the user belongs to', async () => {
      const workspaces = [
        { id: 'ws-1', name: 'First' },
        { id: 'ws-2', name: 'Second' },
      ];
      prisma.workspaceMember.findMany.mockResolvedValue([
        { workspace: workspaces[0] },
        { workspace: workspaces[1] },
      ]);

      const result = await service.findAllByUser(1);

      expect(result).toEqual(workspaces);
      expect(prisma.workspaceMember.findMany).toHaveBeenCalledWith({
        where: { userId: 1 },
        include: { workspace: true },
      });
    });
  });

  describe('findOne', () => {
    it('returns workspace with members if user is a member', async () => {
      const workspace = {
        id: 'ws-1',
        name: 'Test',
        members: [{ userId: 1, role: 'owner', user: { id: 1 } }],
      };
      prisma.workspace.findUnique.mockResolvedValue(workspace);

      const result = await service.findOne('ws-1', 1);

      expect(result).toEqual(workspace);
    });

    it('throws NotFoundException if workspace does not exist', async () => {
      prisma.workspace.findUnique.mockResolvedValue(null);

      await expect(service.findOne('ws-missing', 1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws ForbiddenException if user is not a member', async () => {
      prisma.workspace.findUnique.mockResolvedValue({
        id: 'ws-1',
        name: 'Test',
        members: [{ userId: 99, role: 'owner' }],
      });

      await expect(service.findOne('ws-1', 1)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('update', () => {
    it('throws ForbiddenException if user is not owner', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        role: 'member',
      });

      await expect(
        service.update('ws-1', 1, { name: 'New Name' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('updates workspace name if user is owner', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        role: 'owner',
      });
      prisma.workspace.update.mockResolvedValue({
        id: 'ws-1',
        name: 'New Name',
      });

      const result = await service.update('ws-1', 1, { name: 'New Name' });

      expect(result).toEqual({ id: 'ws-1', name: 'New Name' });
      expect(prisma.workspace.update).toHaveBeenCalledWith({
        where: { id: 'ws-1' },
        data: { name: 'New Name' },
      });
    });
  });

  describe('remove', () => {
    it('throws ForbiddenException if user is not owner', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        role: 'member',
      });

      await expect(service.remove('ws-1', 1)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('deletes workspace if user is owner', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        role: 'owner',
      });
      prisma.workspace.delete.mockResolvedValue({ id: 'ws-1' });

      const result = await service.remove('ws-1', 1);

      expect(result).toEqual({ id: 'ws-1' });
      expect(prisma.workspace.delete).toHaveBeenCalledWith({
        where: { id: 'ws-1' },
      });
    });
  });

  describe('removeMember', () => {
    it('owner can remove another member', async () => {
      prisma.workspaceMember.findUnique
        .mockResolvedValueOnce({ role: 'owner' }) // assertOwner
        .mockResolvedValueOnce({ role: 'member', userId: 2 }); // target lookup
      prisma.workspaceMember.delete.mockResolvedValue({});

      await service.removeMember('ws-1', 1, 2);

      expect(prisma.workspaceMember.delete).toHaveBeenCalledWith({
        where: { workspaceId_userId: { workspaceId: 'ws-1', userId: 2 } },
      });
    });

    it('member can leave workspace (self-remove)', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        role: 'member',
        userId: 2,
      });
      prisma.workspaceMember.delete.mockResolvedValue({});

      await service.removeMember('ws-1', 2, 2);

      expect(prisma.workspaceMember.delete).toHaveBeenCalled();
    });

    it('owner cannot leave their own workspace', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        role: 'owner',
        userId: 1,
      });

      await expect(
        service.removeMember('ws-1', 1, 1),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('non-owner cannot remove others', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        role: 'member',
      });

      await expect(
        service.removeMember('ws-1', 2, 3),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws NotFoundException if target member not found', async () => {
      prisma.workspaceMember.findUnique
        .mockResolvedValueOnce({ role: 'owner' }) // assertOwner
        .mockResolvedValueOnce(null); // target lookup

      await expect(
        service.removeMember('ws-1', 1, 99),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('createInvite', () => {
    it('throws ForbiddenException if user is not owner', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        role: 'member',
      });

      await expect(
        service.createInvite('ws-1', 1, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('creates invite with default role if none specified', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        role: 'owner',
      });
      prisma.workspaceInvite.create.mockResolvedValue({ id: 'inv-1' });

      await service.createInvite('ws-1', 1, {});

      expect(prisma.workspaceInvite.create).toHaveBeenCalledWith({
        data: {
          workspaceId: 'ws-1',
          createdBy: 1,
          role: 'member',
          expiresAt: null,
        },
      });
    });

    it('creates invite with specified role and expiration', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({
        role: 'owner',
      });
      prisma.workspaceInvite.create.mockResolvedValue({ id: 'inv-1' });

      const before = Date.now();
      await service.createInvite('ws-1', 1, {
        role: 'editor',
        expiration: '24h',
      });
      const after = Date.now();

      const createArg = prisma.workspaceInvite.create.mock.calls[0][0];
      expect(createArg.data.role).toBe('editor');
      const expiresAt = createArg.data.expiresAt as Date;
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 24 * 3600000);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(after + 24 * 3600000);
    });
  });

  describe('acceptInvite', () => {
    it('creates membership from valid invite', async () => {
      prisma.workspaceInvite.findUnique.mockResolvedValue({
        token: 'tok-1',
        workspaceId: 'ws-1',
        role: 'member',
        expiresAt: null,
      });
      prisma.workspaceMember.findUnique.mockResolvedValue(null);
      prisma.workspaceMember.create.mockResolvedValue({});

      const result = await service.acceptInvite('tok-1', 5);

      expect(result).toEqual({ workspaceId: 'ws-1' });
      expect(prisma.workspaceMember.create).toHaveBeenCalledWith({
        data: { workspaceId: 'ws-1', userId: 5, role: 'member' },
      });
    });

    it('throws NotFoundException if invite not found', async () => {
      prisma.workspaceInvite.findUnique.mockResolvedValue(null);

      await expect(
        service.acceptInvite('bad-token', 5),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws GoneException if invite has expired', async () => {
      prisma.workspaceInvite.findUnique.mockResolvedValue({
        token: 'tok-1',
        workspaceId: 'ws-1',
        role: 'member',
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.acceptInvite('tok-1', 5),
      ).rejects.toBeInstanceOf(GoneException);
    });

    it('throws ConflictException if user is already a member', async () => {
      prisma.workspaceInvite.findUnique.mockResolvedValue({
        token: 'tok-1',
        workspaceId: 'ws-1',
        role: 'member',
        expiresAt: null,
      });
      prisma.workspaceMember.findUnique.mockResolvedValue({
        role: 'member',
      });

      await expect(
        service.acceptInvite('tok-1', 5),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('assertMember', () => {
    it('returns member if user is a member', async () => {
      const member = { workspaceId: 'ws-1', userId: 1, role: 'member' };
      prisma.workspaceMember.findUnique.mockResolvedValue(member);

      const result = await service.assertMember('ws-1', 1);

      expect(result).toEqual(member);
    });

    it('throws ForbiddenException if user is not a member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(
        service.assertMember('ws-1', 1),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
