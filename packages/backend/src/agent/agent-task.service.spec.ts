import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PgBus, PgBusHandlers } from '../common/pg-bus';
import { PrismaService } from '../database/prisma.service';
import { AGENT_TASK_NOTIFY_CHANNEL } from '../chat/chat-agent-tasks';
import { ChatMessageService } from '../chat/chat-message.service';
import { AgentTaskService, MAX_WAITERS_PER_BOT } from './agent-task.service';

const BOT = 10;

const anyDate: unknown = expect.any(Date);
const OWNER = 1;

function sqlOf(call: unknown[]): string {
  return (call[0] as TemplateStringsArray).join('?');
}

/**
 * `AgentTaskService` against a hand-rolled Prisma and bus. The claim's SQL
 * (row locks, `SKIP LOCKED`, the lease arithmetic) runs for real in
 * `test/workspace-bots.e2e-spec.ts`; here it is pinned by shape, and the
 * wait loop by its timers.
 */
function setup(
  opts: {
    kind?: string;
    /** What successive claims return: a task id, or null for none. */
    claims?: Array<string | null>;
    task?: Record<string, unknown> | null;
    /** What successive lease updates (`updateMany`) count. */
    updates?: number[];
  } = {},
) {
  const { kind = 'bot', claims = [null] } = opts;
  const task =
    opts.task === undefined
      ? {
          id: 't1',
          workspaceId: 'w1',
          botId: BOT,
          invokerId: OWNER,
          triggerMessageId: 'm1',
          channelId: 'c1',
          threadRootId: 'm1',
          status: 'claimed',
          claimedByKeyId: 'key-1',
          createdAt: new Date('2026-11-28T00:00:00Z'),
        }
      : opts.task;
  let claim = 0;
  const updates = [...(opts.updates ?? [])];
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ kind }),
      update: jest.fn().mockResolvedValue({}),
    },
    $executeRaw: jest.fn().mockResolvedValue(0),
    $queryRaw: jest.fn(() => {
      const id = claims[Math.min(claim, claims.length - 1)];
      claim += 1;
      return Promise.resolve(id === null ? [] : [{ id }]);
    }),
    agentTask: {
      findFirst: jest.fn().mockResolvedValue(task),
      findUniqueOrThrow: jest.fn(() =>
        Promise.resolve({
          ...task,
          invoker: { id: OWNER, username: 'alice' },
          channel: { kind: 'public', name: 'general' },
        }),
      ),
      findUnique: jest.fn().mockResolvedValue(task),
      updateMany: jest.fn(() =>
        Promise.resolve({ count: updates.length > 0 ? updates.shift() : 1 }),
      ),
    },
    chatMessage: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ body: '@[deck-bot](10) hi', deletedAt: null }),
    },
  };
  const messages = {
    post: jest.fn().mockResolvedValue({ id: 'reply' }),
    page: jest.fn().mockResolvedValue([{ id: 'm1' }, { id: 'r1' }]),
    get: jest.fn().mockResolvedValue({ id: 'm1' }),
  };
  let handlers: PgBusHandlers | null = null;
  const unlisten = jest.fn().mockResolvedValue(undefined);
  const bus = {
    listen: jest.fn((_channel: string, h: PgBusHandlers) => {
      handlers = h;
      return Promise.resolve(unlisten);
    }),
  };
  const service = new AgentTaskService(
    prisma as unknown as PrismaService,
    messages as unknown as ChatMessageService,
    bus as unknown as PgBus,
  );
  service.pollMs = 20;
  return {
    service,
    prisma,
    messages,
    bus,
    unlisten,
    notify: (payload: string) => handlers?.onNotify(payload),
    connect: () => handlers?.onConnect?.(),
  };
}

describe('AgentTaskService', () => {
  describe('assertBot', () => {
    it('refuses a person with 403', async () => {
      const { service } = setup({ kind: 'person' });
      await expect(service.assertBot(OWNER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('lets a bot through', async () => {
      const { service } = setup();
      await expect(service.assertBot(BOT)).resolves.toBeUndefined();
    });
  });

  describe('next', () => {
    it('claims the oldest queued task and describes it', async () => {
      const { service, prisma } = setup({ claims: ['t1'] });
      const task = await service.next(BOT, 'w1', 0);
      expect(task).toEqual({
        id: 't1',
        channelId: 'c1',
        channelKind: 'public',
        channelName: 'general',
        threadRootId: 'm1',
        triggerMessageId: 'm1',
        invoker: { id: OWNER, username: 'alice' },
        body: '@[deck-bot](10) hi',
        createdAt: '2026-11-28T00:00:00.000Z',
      });
      const claim = sqlOf(prisma.$queryRaw.mock.calls[0]);
      expect(claim).toMatch(/ORDER BY "createdAt", id/);
      expect(claim).toMatch(/"claimedByKeyId"/);
      expect(claim).toMatch(/FOR UPDATE SKIP LOCKED/);
      expect(claim).toMatch(/"leaseExpiresAt"/);
    });

    it('re-queues expired leases before it claims', async () => {
      const { service, prisma } = setup({ claims: ['t1'] });
      await service.next(BOT, 'w1', 0);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      const requeue = sqlOf(prisma.$executeRaw.mock.calls[0] as unknown[]);
      expect(requeue).toMatch(/"status" = 'queued'/);
      expect(requeue).toMatch(/"status" = 'claimed'/);
      expect(requeue).toMatch(/"leaseExpiresAt" </);
      // A re-queued task belongs to no host until the next claim.
      expect(requeue).toMatch(/"claimedByKeyId" = NULL/);
      expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.$queryRaw.mock.invocationCallOrder[0],
      );
    });

    it('records the poll as the bot last seen', async () => {
      const { service, prisma } = setup();
      await service.next(BOT, 'w1', 0);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: BOT },
        data: { botLastSeenAt: anyDate },
      });
    });

    it('returns null at once with no wait and nothing queued', async () => {
      const { service, prisma } = setup();
      await expect(service.next(BOT, 'w1', 0)).resolves.toBeNull();
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('polls until the wait runs out, then returns null', async () => {
      const { service, prisma } = setup();
      const started = Date.now();
      await expect(service.next(BOT, 'w1', 100)).resolves.toBeNull();
      expect(Date.now() - started).toBeGreaterThanOrEqual(95);
      // The fallback poll looked again while it waited.
      expect(prisma.$queryRaw.mock.calls.length).toBeGreaterThan(1);
    });

    it('wakes at once on a NOTIFY for this bot', async () => {
      const { service, notify } = setup({ claims: [null, 't1'] });
      service.pollMs = 60_000;
      await service.onModuleInit();
      const pending = service.next(BOT, 'w1', 30_000);
      await new Promise((r) => setTimeout(r, 10));
      notify(String(BOT));
      await expect(pending).resolves.toMatchObject({ id: 't1' });
      await service.onModuleDestroy();
    });

    it('ignores a NOTIFY for another bot', async () => {
      const { service, prisma, notify } = setup();
      service.pollMs = 60_000;
      await service.onModuleInit();
      const pending = service.next(BOT, 'w1', 80);
      await new Promise((r) => setTimeout(r, 10));
      notify(String(BOT + 1));
      notify('not a number');
      await expect(pending).resolves.toBeNull();
      // The first look, and the one when the wait ran out: no wake between.
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
      await service.onModuleDestroy();
    });

    it('stops waiting when the caller goes away', async () => {
      const { service } = setup();
      const abort = new AbortController();
      const pending = service.next(BOT, 'w1', 30_000, abort.signal);
      await new Promise((r) => setTimeout(r, 10));
      abort.abort();
      await expect(pending).resolves.toBeNull();
      expect(service.waiting).toBe(0);
    });

    it('claims nothing for a caller already gone', async () => {
      const { service, prisma } = setup({ claims: ['t1'] });
      const abort = new AbortController();
      abort.abort();
      await expect(
        service.next(BOT, 'w1', 0, abort.signal),
      ).resolves.toBeNull();
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('hands a task back when the caller left while it was claimed', async () => {
      // A claim that lands after the client hung up would otherwise sit
      // on its lease for ten minutes with nobody working it.
      const { service, prisma } = setup({ claims: ['t1'] });
      const abort = new AbortController();
      const claim = prisma.$queryRaw.getMockImplementation()!;
      prisma.$queryRaw.mockImplementation((...args: unknown[]) => {
        abort.abort();
        return claim(...(args as []));
      });
      await expect(
        service.next(BOT, 'w1', 0, abort.signal, 'key-1'),
      ).resolves.toBeNull();
      expect(prisma.agentTask.updateMany).toHaveBeenCalledWith({
        where: { id: 't1', status: 'claimed', claimedByKeyId: 'key-1' },
        data: {
          status: 'queued',
          claimedAt: null,
          claimedByKeyId: null,
          leaseExpiresAt: null,
        },
      });
    });

    // With NOTIFY doing the waking, a parked wait must not keep hitting
    // the database every second: one bot key would turn into steady writes.
    it('polls slowly once the listener is connected', async () => {
      const { service, prisma, connect } = setup();
      await service.onModuleInit();
      connect();
      service.listeningPollMs = 1_000;
      await service.next(BOT, 'w1', 100);
      // One look now and one as the window closes — not one per 20 ms.
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('polls quickly while no listener is connected', async () => {
      const { service, prisma } = setup();
      await service.next(BOT, 'w1', 100);
      expect(prisma.$queryRaw.mock.calls.length).toBeGreaterThanOrEqual(4);
    });

    it('refuses a wait beyond the per-bot cap with 429', async () => {
      const { service } = setup();
      const abort = new AbortController();
      const parked = Array.from({ length: MAX_WAITERS_PER_BOT }, () =>
        service.next(BOT, 'w1', 30_000, abort.signal),
      );
      await new Promise((r) => setTimeout(r, 10));
      await expect(service.next(BOT, 'w1', 30_000)).rejects.toMatchObject({
        status: 429,
      });
      // Another bot is not affected.
      await expect(service.next(BOT + 1, 'w1', 0)).resolves.toBeNull();
      abort.abort();
      await Promise.all(parked);
    });

    it('leaves no waiter behind after a timeout', async () => {
      const { service } = setup();
      await service.next(BOT, 'w1', 50);
      expect(service.waiting).toBe(0);
    });

    it('listens on agent_task and lets go on shutdown', async () => {
      const { service, bus, unlisten } = setup();
      await service.onModuleInit();
      expect(bus.listen).toHaveBeenCalledWith(
        AGENT_TASK_NOTIFY_CHANNEL,
        expect.any(Object),
      );
      await service.onModuleDestroy();
      expect(unlisten).toHaveBeenCalled();
    });
  });

  describe('a task of another bot', () => {
    it.each(['thread', 'reply', 'complete'] as const)(
      '%s is 404',
      async (route) => {
        const { service, prisma, messages } = setup({ task: null });
        const call =
          route === 'thread'
            ? service.thread(BOT, 'w1', 't1')
            : route === 'reply'
              ? service.reply(BOT, 'w1', 't1', 'hi')
              : service.complete(BOT, 'w1', 't1', 'done');
        await expect(call).rejects.toBeInstanceOf(NotFoundException);
        expect(prisma.agentTask.findFirst).toHaveBeenCalledWith({
          where: { id: 't1', botId: BOT, workspaceId: 'w1' },
        });
        expect(messages.post).not.toHaveBeenCalled();
        expect(prisma.agentTask.updateMany).not.toHaveBeenCalled();
      },
    );
  });

  describe('thread', () => {
    it("reads the task's thread as the bot", async () => {
      const { service, messages } = setup();
      const rows = await service.thread(BOT, 'w1', 't1');
      expect(messages.page).toHaveBeenCalledWith(BOT, 'c1', { thread: 'm1' });
      expect(rows.map((r) => r.id)).toEqual(['m1', 'r1']);
      expect(messages.get).not.toHaveBeenCalled();
    });

    it('puts the root first when the page no longer reaches it', async () => {
      const { service, messages } = setup();
      messages.page.mockResolvedValue([{ id: 'r50' }, { id: 'r51' }]);
      const rows = await service.thread(BOT, 'w1', 't1');
      expect(messages.get).toHaveBeenCalledWith(BOT, 'm1', 'w1');
      expect(rows.map((r) => r.id)).toEqual(['m1', 'r50', 'r51']);
    });
  });

  describe('reply', () => {
    it('posts as the bot in the task thread, tagged with the task and key', async () => {
      const { service, messages } = setup();
      await service.reply(BOT, 'w1', 't1', 'Here you go', 'key-1');
      expect(messages.post).toHaveBeenCalledWith(BOT, 'c1', {
        body: 'Here you go',
        threadRootId: 'm1',
        agentTaskId: 't1',
        apiKeyId: 'key-1',
      });
    });

    it('refuses a finished task with 409', async () => {
      const { service, messages } = setup({
        task: {
          id: 't1',
          workspaceId: 'w1',
          botId: BOT,
          channelId: 'c1',
          threadRootId: 'm1',
          status: 'done',
        },
      });
      await expect(
        service.reply(BOT, 'w1', 't1', 'late'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(messages.post).not.toHaveBeenCalled();
    });

    it("renews the caller's lease before it posts", async () => {
      const { service, prisma, messages } = setup();
      await service.reply(BOT, 'w1', 't1', 'Still on it', 'key-1');
      expect(prisma.agentTask.updateMany).toHaveBeenCalledWith({
        where: { id: 't1', status: 'claimed', claimedByKeyId: 'key-1' },
        data: { leaseExpiresAt: anyDate },
      });
      expect(
        prisma.agentTask.updateMany.mock.invocationCallOrder[0],
      ).toBeLessThan(messages.post.mock.invocationCallOrder[0]);
    });

    it('takes back a task whose lapsed lease was re-queued', async () => {
      const { service, prisma, messages } = setup({ updates: [0, 1] });
      await service.reply(BOT, 'w1', 't1', 'Done', 'key-1');
      expect(prisma.agentTask.updateMany).toHaveBeenLastCalledWith({
        where: { id: 't1', status: 'queued' },
        data: {
          status: 'claimed',
          claimedAt: anyDate,
          claimedByKeyId: 'key-1',
          leaseExpiresAt: anyDate,
        },
      });
      expect(messages.post).toHaveBeenCalled();
    });

    it('refuses with 409 while another host holds the task', async () => {
      const { service, messages } = setup({ updates: [0, 0] });
      await expect(
        service.reply(BOT, 'w1', 't1', 'me too', 'key-2'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(messages.post).not.toHaveBeenCalled();
    });
  });

  describe('complete', () => {
    it('finishes a task the caller holds, or one nobody holds', async () => {
      const { service, prisma } = setup();
      await service.complete(BOT, 'w1', 't1', 'failed', 'key-1');
      expect(prisma.agentTask.updateMany).toHaveBeenCalledWith({
        where: {
          id: 't1',
          OR: [
            { status: 'queued' },
            { status: 'claimed', claimedByKeyId: 'key-1' },
          ],
        },
        data: {
          status: 'failed',
          finishedAt: anyDate,
          leaseExpiresAt: null,
        },
      });
    });

    it('changes nothing on a task already finished', async () => {
      const { service, prisma } = setup({ updates: [0] });
      prisma.agentTask.findUnique.mockResolvedValue({ status: 'done' });
      await expect(
        service.complete(BOT, 'w1', 't1', 'done', 'key-1'),
      ).resolves.toBeUndefined();
    });

    it('refuses with 409 while another host holds the task', async () => {
      const { service } = setup({ updates: [0] });
      await expect(
        service.complete(BOT, 'w1', 't1', 'done', 'key-2'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
