import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { WorkspaceService } from '../../workspace/workspace.service';

function createMockContext(
  user: Record<string, unknown>,
  workspaceId: string,
): ExecutionContext {
  const request = { user, params: { workspaceId } };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('WorkspaceScopeGuard', () => {
  let guard: WorkspaceScopeGuard;
  let workspaceService: { assertMember: jest.Mock; resolveId: jest.Mock };

  beforeEach(() => {
    workspaceService = {
      assertMember: jest.fn().mockResolvedValue({}),
      resolveId: jest.fn().mockImplementation((id: string) => Promise.resolve(id)),
    };
    guard = new WorkspaceScopeGuard(
      workspaceService as unknown as WorkspaceService,
    );
  });

  it('allows API key access when workspaceId matches', async () => {
    const ctx = createMockContext(
      { id: 1, isApiKey: true, workspaceId: 'ws-1' },
      'ws-1',
    );

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(workspaceService.assertMember).not.toHaveBeenCalled();
  });

  it('rejects API key access when workspaceId does not match', async () => {
    const ctx = createMockContext(
      { id: 1, isApiKey: true, workspaceId: 'ws-other' },
      'ws-1',
    );

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('checks workspace membership for JWT users', async () => {
    const ctx = createMockContext({ id: 1 }, 'ws-1');

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(workspaceService.assertMember).toHaveBeenCalledWith('ws-1', 1);
  });

  it('rejects JWT users who are not workspace members', async () => {
    workspaceService.assertMember.mockRejectedValue(
      new ForbiddenException('Not a member'),
    );
    const ctx = createMockContext({ id: 1 }, 'ws-1');

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('resolves slug to UUID and replaces params.workspaceId', async () => {
    workspaceService.resolveId.mockResolvedValue('uuid-123');
    const ctx = createMockContext(
      { id: 1, isApiKey: true, workspaceId: 'uuid-123' },
      'my-slug',
    );

    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(workspaceService.resolveId).toHaveBeenCalledWith('my-slug');
    const request = ctx.switchToHttp().getRequest();
    expect(request.params.workspaceId).toBe('uuid-123');
  });
});
