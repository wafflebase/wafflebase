import { Injectable, Logger } from '@nestjs/common';
import { ChatChannel, Prisma } from '@prisma/client';
import { extractMentionedUserIds } from '@wafflebase/sheets';
import { PrismaService } from '../database/prisma.service';
import { describeError } from './chat-document-refs';
import { ChatUserSummary } from './chat.types';

/**
 * The Postgres NOTIFY channel a new task is announced on, payload the bot's
 * user id. `AgentTaskService` wakes that bot's long-polls on it.
 */
export const AGENT_TASK_NOTIFY_CHANNEL = 'agent_task';

/** What the trigger reads off a message that has just been posted. */
export interface PostedMessage {
  id: string;
  body: string;
  threadRootId: string | null;
  author: ChatUserSummary | null;
}

/** A bot a message addressed, with who may hand it work. */
interface TargetBot {
  id: number;
  botOwnerId: number | null;
  botInvokers: string | null;
}

/**
 * Whether `authorId` may hand `bot` a task. An owner-only bot (the MVP's one
 * setting, and the reading of anything unrecognised) takes work from its
 * owner alone; a `members` bot from anybody who could post here.
 */
function mayInvoke(bot: TargetBot, authorId: number): boolean {
  if (bot.botInvokers === 'members') return true;
  return bot.botOwnerId === authorId;
}

/**
 * Turns a posted chat message into agent tasks
 * (`docs/design/agent-runner.md` § 2, cut to the MVP rule): the bots it
 * mentions, plus — in a DM — the bots in that DM, each only when the author
 * may invoke it. A message a bot wrote never creates one, so two bots cannot
 * talk each other into a loop. Runs after the post has committed, from
 * `ChatMessageService.afterPost`, and never on an edit: a task is one
 * invocation, and editing a message is not asking again.
 *
 * The body it reads is the stored one, whose mention tokens
 * `canonicalBody` already narrowed to people who can read the channel, so a
 * bot outside a private channel is never handed a task about it.
 */
@Injectable()
export class ChatAgentTaskTrigger {
  private readonly logger = new Logger(ChatAgentTaskTrigger.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates the message's tasks and wakes their bots' hosts. Logged and
   * swallowed like the rest of `afterPost`: the message is posted either
   * way, and failing the request would invite a retry that posts it twice.
   */
  async onPosted(message: PostedMessage, channel: ChatChannel): Promise<void> {
    const author = message.author;
    if (!author || author.kind === 'bot') return;
    try {
      const bots = await this.targets(message, channel, author.id);
      const invoked = bots.filter((bot) => mayInvoke(bot, author.id));
      if (invoked.length === 0) return;
      await this.prisma.agentTask.createMany({
        data: invoked.map((bot) => ({
          workspaceId: channel.workspaceId,
          botId: bot.id,
          invokerId: author.id,
          triggerMessageId: message.id,
          channelId: channel.id,
          threadRootId: message.threadRootId ?? message.id,
        })),
      });
      for (const bot of invoked) await this.wake(bot.id);
    } catch (err) {
      this.logger.warn(
        `agent task creation failed for ${message.id}: ${describeError(err)}`,
      );
    }
  }

  /**
   * The bots a message addresses: the ones it mentions and, in a DM, the
   * DM's own bots — each a bot of this workspace that is still a member of
   * it (a deleted bot keeps its `User` row but loses its membership).
   */
  private async targets(
    message: PostedMessage,
    channel: ChatChannel,
    authorId: number,
  ): Promise<TargetBot[]> {
    const mentioned = [
      ...new Set(
        extractMentionedUserIds(message.body)
          .map(Number)
          .filter((id) => Number.isSafeInteger(id) && id > 0)
          .filter((id) => id !== authorId),
      ),
    ];
    const addressed: Prisma.UserWhereInput[] = [];
    if (mentioned.length > 0) addressed.push({ id: { in: mentioned } });
    if (channel.kind === 'dm') {
      addressed.push({ chatMemberships: { some: { channelId: channel.id } } });
    }
    if (addressed.length === 0) return [];
    return this.prisma.user.findMany({
      where: {
        kind: 'bot',
        botWorkspaceId: channel.workspaceId,
        workspaceMembers: { some: { workspaceId: channel.workspaceId } },
        OR: addressed,
      },
      select: { id: true, botOwnerId: true, botInvokers: true },
    });
  }

  /**
   * Best-effort: the task is committed, and a host that misses the wake-up
   * finds it on its next one-second poll.
   */
  private async wake(botId: number): Promise<void> {
    try {
      await this.prisma
        .$executeRaw`SELECT pg_notify(${AGENT_TASK_NOTIFY_CHANNEL}, ${String(botId)})`;
    } catch (err) {
      this.logger.warn(
        `agent task NOTIFY failed for bot ${botId}: ${describeError(err)}`,
      );
    }
  }
}
