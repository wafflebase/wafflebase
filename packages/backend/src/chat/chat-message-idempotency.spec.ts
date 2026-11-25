import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { ChatBus } from './chat-bus';
import { ChatChannelService } from './chat-channel.service';
import { ChatDocumentRefService } from './chat-document-refs';
import { ChatMessageService } from './chat-message.service';

const AUTHOR = 1;

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    channelId: 'c1',
    seq: 7n,
    authorId: AUTHOR,
    apiKeyId: null,
    body: 'hello',
    threadRootId: null,
    alsoInChannel: false,
    replyCount: 0,
    lastReplyAt: null,
    editedAt: null,
    deletedAt: null,
    createdAt: new Date('2026-11-25T00:00:00Z'),
    clientId: 'k1',
    author: { id: AUTHOR, username: 'me', photo: null },
    ...over,
  };
}

/**
 * `post` against a hand-rolled Prisma: enough of the seq-allocating
 * transaction to see whether a send created a row, and the bus and bell it
 * announces to. The real unique index is exercised by `test/chat.e2e-spec.ts`.
 */
function setup() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ lastSeq: 7n }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    chatMessage: {
      create: jest.fn().mockResolvedValue(row()),
      update: jest.fn(),
    },
  };
  const prisma = {
    chatMessage: { findFirst: jest.fn().mockResolvedValue(null) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((cb: (t: typeof tx) => unknown) =>
      cb(tx),
    ) as jest.Mock,
  };
  const channels = {
    resolve: jest.fn().mockResolvedValue({
      channel: { id: 'c1', workspaceId: 'w1', kind: 'public' },
      ctx: {
        kind: 'public',
        archived: false,
        isWorkspaceMember: true,
        isChannelMember: true,
      },
    }),
    announceMembership: jest.fn(),
  };
  const bus = { notifyMessage: jest.fn().mockResolvedValue(undefined) };
  const notifications = {
    createChatMention: jest.fn(),
    createChatThreadReply: jest.fn(),
  };
  const documentRefs = { sync: jest.fn().mockResolvedValue([]) };
  const service = new ChatMessageService(
    prisma as unknown as PrismaService,
    channels as unknown as ChatChannelService,
    bus as unknown as ChatBus,
    notifications as unknown as NotificationService,
    documentRefs as unknown as ChatDocumentRefService,
  );
  return { service, prisma, tx, bus, notifications };
}

describe('ChatMessageService.post idempotency', () => {
  it('stores the clientId with the message', async () => {
    const { service, tx } = setup();
    await service.post(AUTHOR, 'c1', { body: 'hello', clientId: 'k1' });
    const [[args]] = tx.chatMessage.create.mock.calls as [
      [{ data: { clientId: string | null } }],
    ];
    expect(args.data.clientId).toBe('k1');
  });

  it('returns the message an earlier attempt created, without posting again', async () => {
    const { service, prisma, tx, bus, notifications } = setup();
    prisma.chatMessage.findFirst.mockResolvedValue(row());

    const dto = await service.post(AUTHOR, 'c1', {
      body: 'hello @[x](2)',
      clientId: 'k1',
    });

    expect(dto).toMatchObject({ id: 'm1', seq: 7 });
    expect(prisma.chatMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { channelId: 'c1', authorId: AUTHOR, clientId: 'k1' },
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.chatMessage.create).not.toHaveBeenCalled();
    expect(bus.notifyMessage).not.toHaveBeenCalled();
    expect(notifications.createChatMention).not.toHaveBeenCalled();
  });

  it('returns the winner when a concurrent retry loses the unique index', async () => {
    const { service, prisma, bus } = setup();
    prisma.chatMessage.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row({ id: 'winner', seq: 8n }));
    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const dto = await service.post(AUTHOR, 'c1', {
      body: 'hello',
      clientId: 'k1',
    });

    expect(dto).toMatchObject({ id: 'winner', seq: 8 });
    expect(bus.notifyMessage).not.toHaveBeenCalled();
  });

  it('does not look a send up without a clientId', async () => {
    const { service, prisma, bus } = setup();
    await service.post(AUTHOR, 'c1', { body: 'hello' });
    expect(prisma.chatMessage.findFirst).not.toHaveBeenCalled();
    expect(bus.notifyMessage).toHaveBeenCalledTimes(1);
  });

  it('lets an unrelated unique violation through', async () => {
    const { service, prisma } = setup();
    const err = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
    });
    prisma.$transaction.mockRejectedValueOnce(err);
    await expect(service.post(AUTHOR, 'c1', { body: 'hello' })).rejects.toBe(
      err,
    );
  });
});
