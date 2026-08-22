import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedRequest } from 'src/auth/auth.types';
import { WorkspaceService } from 'src/workspace/workspace.service';
import { LakehouseController } from './lakehouse.controller';
import { LakehouseService } from './lakehouse.service';

describe('LakehouseController', () => {
  const request = {
    user: { id: '7' },
  } as unknown as AuthenticatedRequest;

  function setup() {
    const lakehouseService = {
      create: jest.fn().mockResolvedValue({ id: 'source-1' }),
      findAllByWorkspace: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      findRaw: jest
        .fn()
        .mockResolvedValue({ id: 'source-1', workspaceId: 'workspace-1' }),
      update: jest.fn(),
      remove: jest.fn(),
      testConfiguration: jest.fn().mockResolvedValue({ success: true }),
      testConnection: jest.fn(),
      history: jest.fn(),
      tables: jest.fn(),
      read: jest.fn().mockResolvedValue({ rows: [] }),
    };
    const workspaceService = {
      resolveId: jest.fn().mockResolvedValue('workspace-1'),
      assertMember: jest.fn().mockResolvedValue({ role: 'member' }),
    };
    const controller = new LakehouseController(
      lakehouseService as unknown as LakehouseService,
      workspaceService as unknown as WorkspaceService,
    );
    return { controller, lakehouseService, workspaceService };
  }

  it('resolves workspace slugs and checks membership before create', async () => {
    const { controller, lakehouseService, workspaceService } = setup();
    const dto = {
      name: 'events',
      format: 'delta' as const,
      storage: 's3-compatible' as const,
      endpoint: 'http://localhost:9000',
      bucket: 'fixtures',
      basePath: 'delta-events',
      credentials: {
        accessKeyId: 'key',
        secretAccessKey: 'secret',
      },
    };

    await controller.create('analytics', request, dto);

    expect(workspaceService.resolveId).toHaveBeenCalledWith('analytics');
    expect(workspaceService.assertMember).toHaveBeenCalledWith(
      'workspace-1',
      7,
    );
    expect(lakehouseService.create).toHaveBeenCalledWith(7, 'workspace-1', dto);
  });

  it('authorizes source-scoped reads through the owning workspace', async () => {
    const { controller, lakehouseService, workspaceService } = setup();

    await controller.read('source-1', request, {
      asOf: { kind: 'version', version: 2 },
    });

    expect(lakehouseService.findRaw).toHaveBeenCalledWith('source-1');
    expect(workspaceService.assertMember).toHaveBeenCalledWith(
      'workspace-1',
      7,
    );
    expect(lakehouseService.read).toHaveBeenCalledWith('source-1', {
      asOf: { kind: 'version', version: 2 },
    });

    await controller.read('source-1', request);
    expect(lakehouseService.read).toHaveBeenLastCalledWith('source-1', {});
  });

  it('tests a new configuration after checking workspace membership', async () => {
    const { controller, lakehouseService, workspaceService } = setup();
    const dto = {
      name: 'candidate',
      format: 'delta' as const,
      storage: 's3-compatible' as const,
      endpoint: 'http://localhost:9000',
      bucket: 'fixtures',
      basePath: 'delta-events',
      credentials: {
        accessKeyId: 'key',
        secretAccessKey: 'secret',
      },
    };

    await controller.testConfiguration('analytics', request, dto);

    expect(workspaceService.resolveId).toHaveBeenCalledWith('analytics');
    expect(workspaceService.assertMember).toHaveBeenCalledWith(
      'workspace-1',
      7,
    );
    expect(lakehouseService.testConfiguration).toHaveBeenCalledWith(dto);
    expect(lakehouseService.create).not.toHaveBeenCalled();
  });

  it('forwards an optional update body when testing a stored source', async () => {
    const { controller, lakehouseService } = setup();
    const dto = { region: 'ap-northeast-2' };

    await controller.testConnection('source-1', request, dto);

    expect(lakehouseService.testConnection).toHaveBeenCalledWith(
      'source-1',
      dto,
    );
    expect(lakehouseService.update).not.toHaveBeenCalled();

    await controller.testConnection('source-1', request);
    expect(lakehouseService.testConnection).toHaveBeenLastCalledWith(
      'source-1',
      {},
    );
  });

  // Every :id route resolves the source BEFORE it does anything with it, so
  // the membership check is the only thing standing between a caller and
  // another workspace's data. Exercise all of them against a rejecting
  // WorkspaceService: dropping the check from any single route (or letting
  // assertSourceMember swallow) must fail here, not ship green.
  describe('workspace membership on every :id route', () => {
    const routes: Array<{
      name: string;
      call: (controller: LakehouseController) => Promise<unknown>;
      service: string;
    }> = [
      {
        name: 'findOne',
        service: 'findOne',
        call: (c) => c.findOne('source-1', request),
      },
      {
        name: 'update',
        service: 'update',
        call: (c) => c.update('source-1', request, { name: 'renamed' }),
      },
      {
        name: 'remove',
        service: 'remove',
        call: (c) => c.remove('source-1', request),
      },
      {
        name: 'testConnection',
        service: 'testConnection',
        call: (c) => c.testConnection('source-1', request),
      },
      {
        name: 'tables',
        service: 'tables',
        call: (c) => c.tables('source-1', request),
      },
      {
        name: 'history',
        service: 'history',
        call: (c) => c.history('source-1', request, {}),
      },
      {
        name: 'read',
        service: 'read',
        call: (c) => c.read('source-1', request, {}),
      },
    ];

    it.each(routes)(
      '$name refuses a non-member and never reaches the service',
      async ({ call, service }) => {
        const { controller, lakehouseService, workspaceService } = setup();
        workspaceService.assertMember.mockRejectedValue(
          new ForbiddenException('Not a workspace member'),
        );

        await expect(call(controller)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        expect(workspaceService.assertMember).toHaveBeenCalledWith(
          'workspace-1',
          7,
        );
        expect(
          (lakehouseService as Record<string, jest.Mock>)[service],
        ).not.toHaveBeenCalled();
      },
    );

    it.each(routes)(
      '$name checks membership for a member too',
      async ({ call, service }) => {
        const { controller, lakehouseService, workspaceService } = setup();

        await call(controller);

        expect(workspaceService.assertMember).toHaveBeenCalledWith(
          'workspace-1',
          7,
        );
        expect(
          (lakehouseService as Record<string, jest.Mock>)[service],
        ).toHaveBeenCalled();
      },
    );

    it('refuses a non-member listing a workspace, before the service is called', async () => {
      const { controller, lakehouseService, workspaceService } = setup();
      workspaceService.assertMember.mockRejectedValue(
        new ForbiddenException('Not a workspace member'),
      );

      await expect(
        controller.findAll('analytics', request),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(lakehouseService.findAllByWorkspace).not.toHaveBeenCalled();
    });
  });
});
