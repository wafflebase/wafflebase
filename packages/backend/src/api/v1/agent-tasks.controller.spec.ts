import { EventEmitter } from 'events';
import { ForbiddenException } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import type { Response } from 'express';
import { ApiV1AgentTasksController } from './agent-tasks.controller';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ApiKeyWriteScopeGuard } from './api-key-write-scope.guard';
import { AgentTaskService } from '../../agent/agent-task.service';
import { AuthenticatedRequest } from '../../auth/auth.types';

// The handlers trust the route `workspaceId` and the caller's id outright:
// the class-level guards are what bind a key to its workspace and refuse a
// read-only key's writes. These tests call the controller directly, so no
// guard runs here; assert the mounting instead.
describe('ApiV1AgentTasksController guards', () => {
  const guards: unknown[] =
    (Reflect.getMetadata(
      '__guards__',
      ApiV1AgentTasksController,
    ) as unknown[]) ?? [];

  it.each([
    ['CombinedAuthGuard', CombinedAuthGuard],
    ['WorkspaceScopeGuard', WorkspaceScopeGuard],
    ['ApiKeyWriteScopeGuard', ApiKeyWriteScopeGuard],
  ])('mounts %s at the class level', (_name, guard) => {
    expect(guards).toContain(guard);
  });

  it('authenticates before it scopes', () => {
    expect(guards.indexOf(CombinedAuthGuard)).toBeLessThan(
      guards.indexOf(WorkspaceScopeGuard),
    );
  });

  it('answers complete with 204', () => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        // eslint-disable-next-line @typescript-eslint/unbound-method
        ApiV1AgentTasksController.prototype.complete,
      ),
    ).toBe(204);
  });
});

const WS = 'ws-1';
const BOT = 10;

function setup() {
  const tasks = {
    assertBot: jest.fn().mockResolvedValue(undefined),
    next: jest.fn().mockResolvedValue(null),
    thread: jest.fn().mockResolvedValue([]),
    reply: jest.fn().mockResolvedValue({ id: 'reply' }),
    complete: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new ApiV1AgentTasksController(
    tasks as unknown as AgentTaskService,
  );
  const req = {
    user: { id: BOT, isApiKey: true, workspaceId: WS, apiKeyId: 'key-1' },
  } as unknown as AuthenticatedRequest;
  const res = new EventEmitter() as unknown as Response;
  return { controller, tasks, req, res };
}

describe('ApiV1AgentTasksController', () => {
  it('refuses a caller who is not a bot before touching the queue', async () => {
    const { controller, tasks, req, res } = setup();
    tasks.assertBot.mockRejectedValue(new ForbiddenException());
    await expect(
      controller.next(WS, { wait: 0 }, req, res),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.thread(WS, 't1', req)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      controller.reply(WS, 't1', { body: 'hi' }, req),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.complete(WS, 't1', { status: 'done' }, req),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tasks.next).not.toHaveBeenCalled();
    expect(tasks.thread).not.toHaveBeenCalled();
    expect(tasks.reply).not.toHaveBeenCalled();
    expect(tasks.complete).not.toHaveBeenCalled();
  });

  it('waits the requested seconds and wraps the task', async () => {
    const { controller, tasks, req, res } = setup();
    tasks.next.mockResolvedValue({ id: 't1' });
    await expect(controller.next(WS, { wait: 240 }, req, res)).resolves.toEqual(
      { task: { id: 't1' } },
    );
    expect(tasks.next).toHaveBeenCalledWith(
      BOT,
      WS,
      240_000,
      expect.any(AbortSignal),
      'key-1',
    );
  });

  it('answers at once when no wait is given', async () => {
    const { controller, tasks, req, res } = setup();
    await expect(controller.next(WS, {}, req, res)).resolves.toEqual({
      task: null,
    });
    const [call] = tasks.next.mock.calls as unknown[][];
    expect(call[2]).toBe(0);
  });

  it('aborts the wait when the client hangs up', async () => {
    const { controller, tasks, req, res } = setup();
    let signal: AbortSignal | undefined;
    tasks.next.mockImplementation(
      (_b: number, _w: string, _ms: number, s: AbortSignal) => {
        signal = s;
        return new Promise((resolve) =>
          s.addEventListener('abort', () => resolve(null)),
        );
      },
    );
    const pending = controller.next(WS, { wait: 240 }, req, res);
    await new Promise((r) => setImmediate(r));
    (res as unknown as EventEmitter).emit('close');
    await expect(pending).resolves.toEqual({ task: null });
    expect(signal?.aborted).toBe(true);
    expect((res as unknown as EventEmitter).listenerCount('close')).toBe(0);
  });

  it('replies with the key that called', async () => {
    const { controller, tasks, req } = setup();
    await controller.reply(WS, 't1', { body: 'Here you go' }, req);
    expect(tasks.reply).toHaveBeenCalledWith(
      BOT,
      WS,
      't1',
      'Here you go',
      'key-1',
    );
  });

  it('completes with the given outcome and the key that called', async () => {
    const { controller, tasks, req } = setup();
    await controller.complete(WS, 't1', { status: 'failed' }, req);
    expect(tasks.complete).toHaveBeenCalledWith(
      BOT,
      WS,
      't1',
      'failed',
      'key-1',
    );
  });
});
