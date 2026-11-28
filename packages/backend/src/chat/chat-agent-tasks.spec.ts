import { Logger } from '@nestjs/common';
import { ChatChannel } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  AGENT_TASK_NOTIFY_CHANNEL,
  ChatAgentTaskTrigger,
} from './chat-agent-tasks';
import { ChatUserSummary } from './chat.types';

const OWNER = 1;
const OTHER = 2;
const BOT = 10;

type BotRow = { id: number; botOwnerId: number | null; botInvokers: string };

/**
 * `ChatAgentTaskTrigger` against a hand-rolled Prisma whose bot lookup
 * returns `bots`. The lookup's own filter (kind, workspace, membership) runs
 * for real in `test/workspace-bots.e2e-spec.ts`; here it is asserted as a
 * query shape.
 */
function setup(
  opts: { kind?: 'public' | 'private' | 'dm'; bots?: BotRow[] } = {},
) {
  const { kind = 'public', bots = [] } = opts;
  const channel = {
    id: 'c1',
    workspaceId: 'w1',
    kind,
  } as unknown as ChatChannel;
  const prisma = {
    user: { findMany: jest.fn().mockResolvedValue(bots) },
    agentTask: {
      createMany: jest.fn().mockResolvedValue({ count: bots.length }),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  const trigger = new ChatAgentTaskTrigger(prisma as unknown as PrismaService);
  return { trigger, prisma, channel };
}

const person = (id: number): ChatUserSummary => ({
  id,
  username: `user-${id}`,
  photo: null,
  kind: 'person',
});

const message = (over: {
  body?: string;
  threadRootId?: string | null;
  author?: ChatUserSummary | null;
}) => ({
  id: 'm1',
  body: over.body ?? 'hello',
  threadRootId: over.threadRootId ?? null,
  author: over.author === undefined ? person(OWNER) : over.author,
});

const ownerBot: BotRow = { id: BOT, botOwnerId: OWNER, botInvokers: 'owner' };

/** The NOTIFYs sent, as [channel, payload] pairs. */
function notifies(prisma: { $executeRaw: jest.Mock }): unknown[][] {
  return prisma.$executeRaw.mock.calls.map((call: unknown[]) => call.slice(1));
}

describe('ChatAgentTaskTrigger', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it("creates a task when the bot's owner mentions it", async () => {
    const { trigger, prisma, channel } = setup({ bots: [ownerBot] });
    await trigger.onPosted(
      message({ body: `@[deck-bot](${BOT}) hello` }),
      channel,
    );
    expect(prisma.agentTask.createMany).toHaveBeenCalledWith({
      data: [
        {
          workspaceId: 'w1',
          botId: BOT,
          invokerId: OWNER,
          triggerMessageId: 'm1',
          channelId: 'c1',
          threadRootId: 'm1',
        },
      ],
    });
    expect(notifies(prisma)).toEqual([
      [AGENT_TASK_NOTIFY_CHANNEL, String(BOT)],
    ]);
  });

  it('looks up only bots of this workspace that are still members', async () => {
    const { trigger, prisma, channel } = setup({ bots: [ownerBot] });
    await trigger.onPosted(
      message({ body: `@[deck-bot](${BOT}) hello` }),
      channel,
    );
    const [args] = prisma.user.findMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(args.where).toMatchObject({
      kind: 'bot',
      botWorkspaceId: 'w1',
      workspaceMembers: { some: { workspaceId: 'w1' } },
      OR: [{ id: { in: [BOT] } }],
    });
  });

  it('answers in the thread a reply belongs to', async () => {
    const { trigger, prisma, channel } = setup({ bots: [ownerBot] });
    await trigger.onPosted(
      message({ body: `@[deck-bot](${BOT}) again`, threadRootId: 'root' }),
      channel,
    );
    const [{ data }] = prisma.agentTask.createMany.mock.calls[0] as [
      { data: Array<{ threadRootId: string }> },
    ];
    expect(data[0].threadRootId).toBe('root');
  });

  it('creates no task when somebody else mentions an owner-only bot', async () => {
    const { trigger, prisma, channel } = setup({ bots: [ownerBot] });
    await trigger.onPosted(
      message({ body: `@[deck-bot](${BOT}) hi`, author: person(OTHER) }),
      channel,
    );
    expect(prisma.agentTask.createMany).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('creates no task for a message a bot wrote', async () => {
    const { trigger, prisma, channel } = setup({ bots: [ownerBot] });
    await trigger.onPosted(
      message({
        body: `@[deck-bot](${BOT}) talk to yourself`,
        author: { ...person(BOT + 1), kind: 'bot' },
      }),
      channel,
    );
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.agentTask.createMany).not.toHaveBeenCalled();
  });

  it('creates no task when nothing mentions a bot outside a DM', async () => {
    const { trigger, prisma, channel } = setup({ bots: [ownerBot] });
    await trigger.onPosted(message({ body: 'just chatting' }), channel);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.agentTask.createMany).not.toHaveBeenCalled();
  });

  it("creates a task for the owner's DM with the bot, unmentioned", async () => {
    const { trigger, prisma, channel } = setup({
      kind: 'dm',
      bots: [ownerBot],
    });
    await trigger.onPosted(message({ body: 'please summarize' }), channel);
    const [args] = prisma.user.findMany.mock.calls[0] as [
      { where: { OR: unknown[] } },
    ];
    expect(args.where.OR).toEqual([
      { chatMemberships: { some: { channelId: 'c1' } } },
    ]);
    expect(prisma.agentTask.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ botId: BOT, invokerId: OWNER })],
    });
  });

  it('never mentions the author themself as a target', async () => {
    const { trigger, prisma, channel } = setup({ bots: [] });
    await trigger.onPosted(
      message({ body: `@[me](${OWNER}) note to self` }),
      channel,
    );
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('logs and swallows a failed insert', async () => {
    const { trigger, prisma, channel } = setup({ bots: [ownerBot] });
    prisma.agentTask.createMany.mockRejectedValue(new Error('db down'));
    await expect(
      trigger.onPosted(message({ body: `@[deck-bot](${BOT}) hi` }), channel),
    ).resolves.toBeUndefined();
  });

  it('keeps the task when the wake-up NOTIFY fails', async () => {
    const { trigger, prisma, channel } = setup({ bots: [ownerBot] });
    prisma.$executeRaw.mockRejectedValue(new Error('notify down'));
    await expect(
      trigger.onPosted(message({ body: `@[deck-bot](${BOT}) hi` }), channel),
    ).resolves.toBeUndefined();
    expect(prisma.agentTask.createMany).toHaveBeenCalled();
  });
});
