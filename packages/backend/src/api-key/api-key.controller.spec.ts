import { ForbiddenException } from '@nestjs/common';
import { ApiKeyController } from './api-key.controller';
import { ApiKeyService } from './api-key.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { AuthenticatedRequest } from '../auth/auth.types';

function requestFor(userId: number) {
  return { user: { id: String(userId) } } as unknown as AuthenticatedRequest;
}

describe('ApiKeyController', () => {
  const OWNER = 1;
  const MEMBER = 2;

  let controller: ApiKeyController;
  let apiKeyService: {
    create: jest.Mock;
    list: jest.Mock;
    revoke: jest.Mock;
  };
  let workspaceService: {
    resolveId: jest.Mock;
    assertMember: jest.Mock;
  };

  beforeEach(() => {
    apiKeyService = {
      create: jest.fn().mockResolvedValue({ id: 'k1' }),
      list: jest.fn().mockResolvedValue([]),
      revoke: jest.fn().mockResolvedValue(undefined),
    };
    workspaceService = {
      resolveId: jest.fn().mockResolvedValue('ws-1'),
      assertMember: jest.fn((_workspaceId: string, userId: number) => {
        if (userId === OWNER) return Promise.resolve({ role: 'owner' });
        if (userId === MEMBER) return Promise.resolve({ role: 'member' });
        return Promise.reject(
          new ForbiddenException('Not a member of this workspace'),
        );
      }),
    };
    controller = new ApiKeyController(
      apiKeyService as unknown as ApiKeyService,
      workspaceService as unknown as WorkspaceService,
    );
  });

  describe('create', () => {
    it('lets an ordinary member mint a key', async () => {
      await controller.create('ws-1', requestFor(MEMBER), { name: 'CI' });

      expect(apiKeyService.create).toHaveBeenCalledWith(
        MEMBER,
        'ws-1',
        'CI',
        undefined,
        undefined,
      );
    });

    it('still refuses a non-member', async () => {
      await expect(
        controller.create('ws-1', requestFor(99), { name: 'CI' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(apiKeyService.create).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('narrows a member to their own keys', async () => {
      await controller.list('ws-1', requestFor(MEMBER));

      expect(apiKeyService.list).toHaveBeenCalledWith('ws-1', {
        createdBy: MEMBER,
      });
    });

    it('shows an owner every key in the workspace', async () => {
      await controller.list('ws-1', requestFor(OWNER));

      expect(apiKeyService.list).toHaveBeenCalledWith('ws-1', {});
    });
  });

  describe('revoke', () => {
    it('scopes a member to their own keys', async () => {
      await controller.revoke('ws-1', 'k1', requestFor(MEMBER));

      expect(apiKeyService.revoke).toHaveBeenCalledWith('k1', 'ws-1', {
        createdBy: MEMBER,
      });
    });

    it('lets an owner revoke any key', async () => {
      await controller.revoke('ws-1', 'k1', requestFor(OWNER));

      expect(apiKeyService.revoke).toHaveBeenCalledWith('k1', 'ws-1', {});
    });

    it('refuses a non-member before reaching the service', async () => {
      await expect(
        controller.revoke('ws-1', 'k1', requestFor(99)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(apiKeyService.revoke).not.toHaveBeenCalled();
    });
  });
});
