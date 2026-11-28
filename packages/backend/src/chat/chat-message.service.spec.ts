import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { AccessContext } from './chat-access';
import { ChatAgentTaskTrigger } from './chat-agent-tasks';
import { ChatBus } from './chat-bus';
import { ChatChannelService } from './chat-channel.service';
import { ChatMessageService } from './chat-message.service';
import { ChatDocumentRefService } from './chat-document-refs';

const AUTHOR = 1;

const anyDate: unknown = expect.any(Date);

type Kind = 'public' | 'private' | 'dm';

/**
 * `ChatMessageService` against a hand-rolled Prisma, with
 * `ChatChannelService.resolve` stubbed to a readable channel. Pins the
 * thread bookkeeping, the edit's bell sync and mention canonicalization; the
 * SQL (row locks, the `replyCount` recount) runs for real in
 * `test/chat.e2e-spec.ts`.
 */
function setup(
  opts: {
    kind?: Kind;
    /** The message `edit` / `remove` find. */
    message?: Record<string, unknown> | null;
    /** The root `post` checks a reply against. */
    root?: Record<string, unknown> | null;
    /** Rows the guarded root bump updates: 0 = the root was deleted. */
    rootBumped?: number;
    /** Rows the guarded soft delete updates: 0 = deleted already. */
    softDeleted?: number;
    /** Users `canonicalBody` resolves (id → username). */
    users?: Array<{ id: number; username: string }>;
    /** Who the mention lookup finds in the workspace / the channel. */
    workspaceMembers?: number[];
    channelMembers?: number[];
  } = {},
) {
  const {
    kind = 'public',
    message = {
      id: 'm1',
      channelId: 'c1',
      authorId: AUTHOR,
      threadRootId: null,
      deletedAt: null,
    },
    root = null,
    rootBumped = 1,
    softDeleted = 1,
    users = [],
    workspaceMembers = [],
    channelMembers = [],
  } = opts;
  const channel = {
    id: 'c1',
    workspaceId: 'w1',
    kind,
    archivedAt: null,
    lastSeq: 5n,
  };
  const ctx: AccessContext = {
    kind,
    archived: false,
    isWorkspaceMember: true,
    isChannelMember: true,
  };
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'm1',
    channelId: 'c1',
    seq: 6n,
    authorId: AUTHOR,
    author: { id: AUTHOR, username: 'alice', photo: null, kind: 'person' },
    body: 'hello',
    threadRootId: null,
    alsoInChannel: false,
    replyCount: 0,
    lastReplyAt: null,
    editedAt: null,
    deletedAt: null,
    createdAt: new Date('2026-11-25T00:00:00Z'),
    ...over,
  });
  let lastEditBody = '';
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ lastSeq: 6n }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    chatMessage: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(row(data)),
      ),
      updateMany: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          count: 'deletedAt' in data ? softDeleted : rootBumped,
        }),
      ),
    },
    notification: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    chatDocumentRef: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const prisma = {
    chatMessage: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === 'm1' ? message : root),
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn(() =>
        Promise.resolve(row({ body: lastEditBody, editedAt: new Date() })),
      ),
    },
    user: {
      findMany: jest.fn().mockResolvedValue(users),
    },
    workspaceMember: {
      findMany: jest
        .fn()
        .mockResolvedValue(workspaceMembers.map((userId) => ({ userId }))),
    },
    chatChannelMember: {
      findMany: jest
        .fn()
        .mockResolvedValue(channelMembers.map((userId) => ({ userId }))),
    },
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  prisma.chatMessage.updateMany.mockImplementation(
    ({ data }: { data: { body: string } }) => {
      lastEditBody = data.body;
      return Promise.resolve({ count: 1 });
    },
  );
  const channels = {
    resolve: jest.fn().mockResolvedValue({ channel, ctx }),
    announceMembership: jest.fn().mockResolvedValue(undefined),
  };
  const bus = {
    notifyMessage: jest.fn().mockResolvedValue(undefined),
    notifyUpdate: jest.fn().mockResolvedValue(undefined),
  };
  const notifications = {
    createChatMention: jest.fn().mockResolvedValue({ created: 0 }),
    createChatThreadReply: jest.fn().mockResolvedValue({ created: 0 }),
    syncChatMessage: jest.fn().mockResolvedValue(undefined),
  };
  const documentRefs = { sync: jest.fn().mockResolvedValue([]) };
  const agentTasks = { onPosted: jest.fn().mockResolvedValue(undefined) };
  const service = new ChatMessageService(
    prisma as unknown as PrismaService,
    channels as unknown as ChatChannelService,
    bus as unknown as ChatBus,
    notifications as unknown as NotificationService,
    documentRefs as unknown as ChatDocumentRefService,
    agentTasks as unknown as ChatAgentTaskTrigger,
  );
  return { service, prisma, tx, notifications, agentTasks };
}

describe('ChatMessageService', () => {
  describe('thread bookkeeping', () => {
    it('refuses a reply to a deleted root before touching the channel', async () => {
      const { service, prisma } = setup({
        root: {
          channelId: 'c1',
          threadRootId: null,
          deletedAt: new Date(),
        },
      });
      await expect(
        service.post(AUTHOR, 'c1', { body: 'late', threadRootId: 'r1' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses a reply whose root is deleted under the lock', async () => {
      const { service } = setup({
        root: { channelId: 'c1', threadRootId: null, deletedAt: null },
        rootBumped: 0,
      });
      await expect(
        service.post(AUTHOR, 'c1', { body: 'late', threadRootId: 'r1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('bumps a live root only', async () => {
      const { service, tx } = setup({
        root: { channelId: 'c1', threadRootId: null, deletedAt: null },
      });
      await service.post(AUTHOR, 'c1', { body: 'reply', threadRootId: 'r1' });
      expect(tx.chatMessage.updateMany).toHaveBeenCalledWith({
        where: { id: 'r1', deletedAt: null },
        data: {
          replyCount: { increment: 1 },
          lastReplyAt: anyDate,
        },
      });
    });

    it('deleting a reply recounts its root', async () => {
      const { service, tx } = setup({
        message: {
          id: 'm1',
          channelId: 'c1',
          authorId: AUTHOR,
          threadRootId: 'r1',
          deletedAt: null,
        },
      });
      await service.remove(AUTHOR, 'm1');
      // The root is locked first, so the recount's own statement snapshot
      // sees a reply a racing post committed while it held that lock.
      const lock = tx.$queryRaw.mock.calls.find(([q]) =>
        (q as TemplateStringsArray).join('?').includes('FOR UPDATE'),
      ) as [TemplateStringsArray, ...unknown[]] | undefined;
      expect(lock).toBeDefined();
      expect(lock!.slice(1)).toEqual(['r1']);
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      const [sql, ...values] = tx.$executeRaw.mock.calls[0] as [
        TemplateStringsArray,
        ...unknown[],
      ];
      // A real recount of the replies still standing, not a decrement, so
      // a count that ever drifted heals on the next delete.
      const text = sql.join('?');
      expect(text).not.toMatch(/GREATEST/);
      expect(text).toMatch(/"replyCount" = \(\s*SELECT count\(\*\)/);
      expect(text).toMatch(/"deletedAt" IS NULL/);
      expect(values).toEqual(['r1']);
    });

    it('deleting a top-level message touches no root', async () => {
      const { service, tx } = setup();
      await service.remove(AUTHOR, 'm1');
      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(tx.notification.deleteMany).toHaveBeenCalled();
    });

    it('a delete that lost the race is 404 and recounts nothing', async () => {
      const { service, tx } = setup({
        message: {
          id: 'm1',
          channelId: 'c1',
          authorId: AUTHOR,
          threadRootId: 'r1',
          deletedAt: null,
        },
        softDeleted: 0,
      });
      await expect(service.remove(AUTHOR, 'm1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('edit', () => {
    it('syncs the bell with the edited mentions', async () => {
      const { service, notifications } = setup({
        users: [{ id: 2, username: 'bob' }],
        workspaceMembers: [2],
        channelMembers: [2],
      });
      await service.edit(AUTHOR, 'm1', 'now @[bob](2)');
      expect(notifications.syncChatMessage).toHaveBeenCalledWith({
        workspaceId: 'w1',
        actorId: AUTHOR,
        channelId: 'c1',
        messageId: 'm1',
        threadRootId: null,
        recipients: [2],
        preview: 'now @[bob](2)',
      });
    });

    it('syncs with no recipients when every mention was edited out', async () => {
      const { service, notifications } = setup();
      await service.edit(AUTHOR, 'm1', 'no mentions now');
      expect(notifications.syncChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({ recipients: [] }),
      );
    });

    it('logs a failed bell sync without the message body', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      try {
        const { service, notifications } = setup();
        const secret = 'the private plan nobody should read in a log';
        notifications.syncChatMessage.mockRejectedValue(
          Object.assign(
            new Error(`Invalid updateMany({ preview: "${secret}" })`),
            {
              name: 'PrismaClientValidationError',
            },
          ),
        );
        await service.edit(AUTHOR, 'm1', secret);
        const line = String(warn.mock.calls[0][0]);
        expect(line).toContain('PrismaClientValidationError');
        expect(line).not.toContain(secret);
      } finally {
        warn.mockRestore();
      }
    });

    it('logs a failed post notification without the message body', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      try {
        const { service, notifications } = setup({
          users: [{ id: 2, username: 'bob' }],
          workspaceMembers: [2],
          channelMembers: [2],
        });
        const secret = 'the private plan nobody should read in a log';
        notifications.createChatMention.mockRejectedValue(
          Object.assign(
            new Error(`Invalid createMany({ preview: "${secret}" })`),
            {
              name: 'PrismaClientValidationError',
            },
          ),
        );
        await service.post(AUTHOR, 'c1', { body: `${secret} @[bob](2)` });
        const lines = warn.mock.calls.map((c) => String(c[0]));
        expect(
          lines.some((l) => l.includes('PrismaClientValidationError')),
        ).toBe(true);
        expect(lines.some((l) => l.includes(secret))).toBe(false);
      } finally {
        warn.mockRestore();
      }
    });

    it('keeps the edit when the bell sync fails', async () => {
      const { service, notifications } = setup();
      notifications.syncChatMessage.mockRejectedValue(new Error('down'));
      await expect(service.edit(AUTHOR, 'm1', 'x')).resolves.toMatchObject({
        body: 'x',
      });
    });
  });

  describe('agent tasks', () => {
    it('hands a new post to the task trigger with its channel', async () => {
      const { service, agentTasks } = setup();
      const dto = await service.post(AUTHOR, 'c1', { body: 'hello' });
      expect(agentTasks.onPosted).toHaveBeenCalledWith(
        dto,
        expect.objectContaining({ id: 'c1', workspaceId: 'w1' }),
      );
    });

    it('never creates a task on an edit', async () => {
      const { service, agentTasks } = setup();
      await service.edit(AUTHOR, 'm1', 'changed');
      expect(agentTasks.onPosted).not.toHaveBeenCalled();
    });

    it('stores the task and the API key a message was posted under', async () => {
      const { service, tx } = setup();
      await service.post(AUTHOR, 'c1', {
        body: 'done',
        agentTaskId: 't1',
        apiKeyId: 'k1',
      });
      const [arg] = tx.chatMessage.create.mock.calls[0] as [
        { data: { agentTaskId: string | null; apiKeyId: string | null } },
      ];
      expect(arg.data.agentTaskId).toBe('t1');
      expect(arg.data.apiKeyId).toBe('k1');
    });

    it('stores neither for an ordinary post', async () => {
      const { service, tx } = setup();
      await service.post(AUTHOR, 'c1', { body: 'hello' });
      const [arg] = tx.chatMessage.create.mock.calls[0] as [
        { data: { agentTaskId: string | null; apiKeyId: string | null } },
      ];
      expect(arg.data.agentTaskId).toBeNull();
      expect(arg.data.apiKeyId).toBeNull();
    });

    it("reports the author's kind on the message", async () => {
      const { service } = setup();
      const dto = await service.post(AUTHOR, 'c1', { body: 'hello' });
      expect(dto.author).toEqual({
        id: AUTHOR,
        username: 'alice',
        photo: null,
        kind: 'person',
      });
    });
  });

  describe('mentions of people who cannot read the channel', () => {
    it('resolves names among channel members in a private channel', async () => {
      const { service, prisma } = setup({ kind: 'private' });
      await service.post(AUTHOR, 'c1', { body: 'hi @[bob](2)' });
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: [2] },
          workspaceMembers: { some: { workspaceId: 'w1' } },
          chatMemberships: { some: { channelId: 'c1' } },
        },
        select: { id: true, username: true },
      });
    });

    it('flattens a mention nobody in the channel answers to', async () => {
      // bob is in the workspace but not this DM, so the lookup finds nobody.
      const { service, tx } = setup({ kind: 'dm', users: [] });
      await service.post(AUTHOR, 'c1', { body: 'hi @[bob](2)' });
      const [arg] = tx.chatMessage.create.mock.calls[0] as [
        { data: { body: string } },
      ];
      expect(arg.data.body).toBe('hi @bob');
    });

    it('resolves among workspace members in a public channel', async () => {
      const { service, prisma } = setup({ kind: 'public' });
      await service.post(AUTHOR, 'c1', { body: 'hi @[bob](2)' });
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: [2] },
          workspaceMembers: { some: { workspaceId: 'w1' } },
        },
        select: { id: true, username: true },
      });
    });
  });
});
