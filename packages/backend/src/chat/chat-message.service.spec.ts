import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { AccessContext } from './chat-access';
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
    author: { id: AUTHOR, username: 'alice', photo: null },
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
  const service = new ChatMessageService(
    prisma as unknown as PrismaService,
    channels as unknown as ChatChannelService,
    bus as unknown as ChatBus,
    notifications as unknown as NotificationService,
    documentRefs as unknown as ChatDocumentRefService,
  );
  return { service, prisma, tx, notifications };
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
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      const [sql, ...values] = tx.$executeRaw.mock.calls[0] as [
        TemplateStringsArray,
        ...unknown[],
      ];
      expect(sql.join('?')).toMatch(/"replyCount" = GREATEST/);
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

    it('keeps the edit when the bell sync fails', async () => {
      const { service, notifications } = setup();
      notifications.syncChatMessage.mockRejectedValue(new Error('down'));
      await expect(service.edit(AUTHOR, 'm1', 'x')).resolves.toMatchObject({
        body: 'x',
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
