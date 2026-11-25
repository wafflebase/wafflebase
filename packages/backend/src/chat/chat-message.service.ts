import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ChatChannel, ChatMessage, Prisma } from '@prisma/client';
import { extractMentionedUserIds } from '@wafflebase/sheets';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { AccessContext, canPost, mentionOutcome } from './chat-access';
import { ChatBus } from './chat-bus';
import { ChatChannelService } from './chat-channel.service';
import { canonicalMentions } from './chat-mentions';
import { MAX_BODY_LENGTH } from './chat.dto';
import {
  ChatDocumentRefService,
  REFS_INCLUDE,
  RefRow,
  toRefDtos,
} from './chat-document-refs';
import { ChatMessageDto, ChatUserSummary } from './chat.types';

export const PAGE_SIZE = 50;

/**
 * Twenty parallel posts to one channel queue on its row lock, each holding a
 * pooled connection while it waits, so Prisma's 2 s default for acquiring
 * one is too tight for a busy channel.
 */
const POST_TRANSACTION = { maxWait: 10_000, timeout: 10_000 };

const AUTHOR = { select: { id: true, username: true, photo: true } } as const;

/** What a message read includes: its author and its document cards. */
const MESSAGE_INCLUDE = {
  author: AUTHOR,
  refs: REFS_INCLUDE,
  channel: { select: { workspaceId: true } },
} as const;

type MessageRow = ChatMessage & {
  author: ChatUserSummary | null;
  refs?: RefRow[];
  channel?: { workspaceId: string };
};

function toDto(m: MessageRow): ChatMessageDto {
  return {
    id: m.id,
    channelId: m.channelId,
    seq: Number(m.seq),
    author: m.author,
    body: m.deletedAt ? '' : m.body,
    threadRootId: m.threadRootId,
    alsoInChannel: m.alsoInChannel,
    replyCount: m.replyCount,
    lastReplyAt: m.lastReplyAt ? m.lastReplyAt.toISOString() : null,
    editedAt: m.editedAt ? m.editedAt.toISOString() : null,
    deleted: m.deletedAt !== null,
    createdAt: m.createdAt.toISOString(),
    refs:
      m.deletedAt || !m.channel ? [] : toRefDtos(m.refs, m.channel.workspaceId),
  };
}

/** Trimmed, non-empty and within the cap, or a 400. */
function checkBody(raw: string): string {
  const body = raw.trim();
  if (body.length === 0) {
    throw new BadRequestException('Message body must not be empty');
  }
  if (body.length > MAX_BODY_LENGTH) {
    throw new BadRequestException(
      `Message body must be at most ${MAX_BODY_LENGTH} characters`,
    );
  }
  return body;
}

/**
 * Messages, threads and read position. Authorization is
 * `ChatChannelService.resolve` (read) plus `canPost` (write); this service
 * adds only what is specific to a message: author-only edits and the `seq`
 * allocation that orders a channel.
 */
@Injectable()
export class ChatMessageService {
  private readonly logger = new Logger(ChatMessageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChatChannelService,
    private readonly bus: ChatBus,
    private readonly notifications: NotificationService,
    private readonly documentRefs: ChatDocumentRefService,
  ) {}

  /**
   * Posts a message. One transaction allocates the next `seq` under the
   * channel's row lock, inserts, bumps a thread root's reply count, and moves
   * the author's read position to their own message — joining a public
   * channel they were not in, which is what posting there means. A
   * thread-only reply joins too but leaves an existing read position alone,
   * since replying in a thread is not reading the channel. Only after
   * it commits do other replicas hear of it, so nobody is told about a
   * message they cannot fetch yet.
   */
  async post(
    userId: number,
    channelId: string,
    data: { body: string; threadRootId?: string; alsoInChannel?: boolean },
  ): Promise<ChatMessageDto> {
    checkBody(data.body);
    const { channel, ctx } = await this.channels.resolve(userId, channelId);
    if (!canPost(ctx)) throw new ConflictException('Channel is archived');
    const body = await this.canonicalBody(data.body, channel.workspaceId);

    const threadRootId = data.threadRootId ?? null;
    if (threadRootId !== null) {
      const root = await this.prisma.chatMessage.findUnique({
        where: { id: threadRootId },
        select: { channelId: true, threadRootId: true },
      });
      if (!root || root.channelId !== channelId || root.threadRootId !== null) {
        throw new BadRequestException(
          'threadRootId must be a top-level message in this channel',
        );
      }
    }
    // "Also send to channel" only means something for a reply.
    const alsoInChannel = threadRootId !== null && data.alsoInChannel === true;

    const created = await this.prisma.$transaction(async (tx) => {
      // The archive check is repeated here, under the lock, so a channel
      // archived after `resolve` cannot take one more message.
      const allocated = await tx.$queryRaw<{ lastSeq: bigint }[]>`
        UPDATE "ChatChannel"
        SET "lastSeq" = "lastSeq" + 1,
            "lastMessageAt" = now() AT TIME ZONE 'UTC'
        WHERE id = ${channelId} AND "archivedAt" IS NULL
        RETURNING "lastSeq"`;
      if (allocated.length === 0) {
        throw new ConflictException('Channel is archived');
      }
      const seq = allocated[0].lastSeq;

      const message = await tx.chatMessage.create({
        data: {
          channelId,
          seq,
          authorId: userId,
          body,
          threadRootId,
          alsoInChannel,
        },
        include: { author: AUTHOR },
      });
      if (threadRootId !== null) {
        await tx.chatMessage.update({
          where: { id: threadRootId },
          data: {
            replyCount: { increment: 1 },
            lastReplyAt: message.createdAt,
          },
        });
      }
      // A message in the channel's own flow (top-level, or a reply also
      // sent to it) is posting there, so it reads everything up to it. A
      // thread-only reply is not: the author may never have seen the
      // channel's latest messages, so an existing read position stays put.
      // Either way a non-member joins, at the tail, as `join` would.
      if (threadRootId === null || alsoInChannel) {
        await tx.$executeRaw`
          INSERT INTO "ChatChannelMember" ("channelId", "userId", "lastReadSeq")
          VALUES (${channelId}, ${userId}, ${seq})
          ON CONFLICT ("channelId", "userId") DO UPDATE
          SET "lastReadSeq" = GREATEST(
            "ChatChannelMember"."lastReadSeq", EXCLUDED."lastReadSeq")`;
      } else {
        await tx.$executeRaw`
          INSERT INTO "ChatChannelMember" ("channelId", "userId", "lastReadSeq")
          VALUES (${channelId}, ${userId}, ${seq})
          ON CONFLICT ("channelId", "userId") DO NOTHING`;
      }
      return message;
    }, POST_TRANSACTION);

    const dto = toDto(created);
    dto.refs = await this.documentRefs.sync(dto.id, channel, body);
    try {
      await this.bus.notifyMessage({
        t: 'msg',
        c: channelId,
        w: channel.workspaceId,
        s: dto.seq,
        r: threadRootId,
        a: userId,
        i: alsoInChannel,
      });
    } catch (err) {
      // Committed already: a client that misses this event catches up by
      // `after=<seq>` on its next reconnect, whereas failing the request
      // would invite a retry that posts the message twice.
      this.logger.warn(
        `chat message notify failed for ${channelId}: ${String(err)}`,
      );
    }
    if (!ctx.isChannelMember) {
      await this.channels.announceMembership(channelId);
    }
    await this.afterPost(dto, channel, ctx);
    return dto;
  }

  /**
   * One page of a channel, oldest first. Without a cursor it is the newest
   * page; `before` pages back and `after` pages forward (the catch-up
   * cursor). Without `thread` only the channel's own flow is returned —
   * top-level messages and replies also sent to it. With `thread` it is that
   * thread, root first, since the root has the lowest `seq` in it.
   */
  async page(
    userId: number,
    channelId: string,
    query: { before?: number; after?: number; thread?: string },
  ): Promise<ChatMessageDto[]> {
    await this.channels.resolve(userId, channelId);

    const where: Prisma.ChatMessageWhereInput = { channelId };
    if (query.thread !== undefined) {
      const root = await this.prisma.chatMessage.findUnique({
        where: { id: query.thread },
        select: { channelId: true, threadRootId: true },
      });
      if (!root || root.channelId !== channelId || root.threadRootId !== null) {
        throw new NotFoundException('Thread not found');
      }
      where.OR = [{ id: query.thread }, { threadRootId: query.thread }];
    } else {
      where.OR = [{ threadRootId: null }, { alsoInChannel: true }];
    }
    const seq: Prisma.BigIntFilter = {};
    if (query.before !== undefined) seq.lt = BigInt(query.before);
    if (query.after !== undefined) seq.gt = BigInt(query.after);
    if (query.before !== undefined || query.after !== undefined) {
      where.seq = seq;
    }

    const forward = query.after !== undefined;
    const rows = await this.prisma.chatMessage.findMany({
      where,
      orderBy: { seq: forward ? 'asc' : 'desc' },
      take: PAGE_SIZE,
      include: MESSAGE_INCLUDE,
    });
    if (!forward) rows.reverse();
    return rows.map(toDto);
  }

  /**
   * One message, for a deep link that knows only its id (the bell carries a
   * channel and a message, and only the message says whether it is a thread
   * reply). A message in a channel the caller cannot read is 404, exactly as
   * an unknown id is.
   */
  async get(
    userId: number,
    messageId: string,
    workspaceIdOrSlug?: string,
  ): Promise<ChatMessageDto> {
    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      include: MESSAGE_INCLUDE,
    });
    if (!message) throw new NotFoundException('Message not found');
    await this.channels.resolve(userId, message.channelId, workspaceIdOrSlug);
    return toDto(message);
  }

  /**
   * Edit one's own message. Another author's message, a deleted one, and one
   * in a channel the caller can no longer read are all the same 404.
   */
  async edit(
    userId: number,
    messageId: string,
    body: string,
    workspaceIdOrSlug?: string,
  ): Promise<ChatMessageDto> {
    checkBody(body);
    const { message, channel } = await this.ownMessage(
      userId,
      messageId,
      workspaceIdOrSlug,
    );
    const text = await this.canonicalBody(body, channel.workspaceId);
    // `deletedAt: null` in the write itself: a delete that commits after
    // `ownMessage` read the row must not have its cleared body written back.
    const { count } = await this.prisma.chatMessage.updateMany({
      where: { id: messageId, deletedAt: null },
      data: { body: text, editedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException('Message not found');
    await this.documentRefs.sync(messageId, channel, text);
    const updated = await this.prisma.chatMessage.findUniqueOrThrow({
      where: { id: messageId },
      include: MESSAGE_INCLUDE,
    });
    await this.announceUpdate(message, channel);
    return toDto(updated);
  }

  /**
   * Soft delete: the row stays so its `seq` keeps the channel gap-free and a
   * thread root keeps its replies reachable. The body is cleared, and so are
   * the bell rows that quote it — a `chat_mention` or `chat_thread_reply`
   * carries a preview of the message in `commentId` — so the text is gone
   * from the database and not merely hidden.
   */
  async remove(
    userId: number,
    messageId: string,
    workspaceIdOrSlug?: string,
  ): Promise<void> {
    const { message, channel } = await this.ownMessage(
      userId,
      messageId,
      workspaceIdOrSlug,
    );
    await this.prisma.$transaction([
      this.prisma.chatMessage.update({
        where: { id: messageId },
        data: { body: '', deletedAt: new Date() },
      }),
      this.prisma.chatDocumentRef.deleteMany({ where: { messageId } }),
      this.prisma.notification.deleteMany({
        where: {
          commentId: messageId,
          type: { in: ['chat_mention', 'chat_thread_reply'] },
        },
      }),
    ]);
    await this.announceUpdate(message, channel);
  }

  /**
   * Advance the caller's read position. `GREATEST` keeps it from moving
   * backwards when two tabs report out of order, and it is capped at the
   * channel's last allocated `seq` so a client cannot pre-read messages that
   * do not exist yet. A public channel the caller has not joined has no read
   * position, so there is nothing to move.
   */
  async markRead(
    userId: number,
    channelId: string,
    seq: number,
  ): Promise<void> {
    await this.channels.resolve(userId, channelId);
    await this.prisma.$executeRaw`
      UPDATE "ChatChannelMember" m
      SET "lastReadSeq" = GREATEST(m."lastReadSeq", LEAST(${BigInt(seq)}, c."lastSeq"))
      FROM "ChatChannel" c
      WHERE c.id = m."channelId"
        AND m."channelId" = ${channelId}
        AND m."userId" = ${userId}`;
  }

  private async ownMessage(
    userId: number,
    messageId: string,
    workspaceIdOrSlug?: string,
  ): Promise<{ message: ChatMessage; channel: ChatChannel }> {
    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
    });
    if (!message || message.authorId !== userId || message.deletedAt) {
      throw new NotFoundException('Message not found');
    }
    const { channel, ctx } = await this.channels.resolve(
      userId,
      message.channelId,
      workspaceIdOrSlug,
    );
    if (!canPost(ctx)) throw new ConflictException('Channel is archived');
    return { message, channel };
  }

  /**
   * Tell the channel's open streams that a message changed, after the write
   * has committed. Ids only: each client refetches the message, so the new
   * text (or its absence) is read under the reader's own access. A failure
   * is logged, never thrown — the edit stands, as a post does.
   */
  private async announceUpdate(
    message: ChatMessage,
    channel: ChatChannel,
  ): Promise<void> {
    try {
      await this.bus.notifyUpdate({
        t: 'upd',
        c: channel.id,
        w: channel.workspaceId,
        id: message.id,
        r: message.threadRootId,
      });
    } catch (err) {
      this.logger.warn(
        `chat update notify failed for ${message.id}: ${String(err)}`,
      );
    }
  }

  /**
   * The body as stored: every mention token rewritten to its target's real
   * username, so `@[ceo](42)` cannot dress user 42 up as somebody else. A
   * token whose id is not a member of the workspace is flattened to plain
   * `@name` — it names nobody who could be notified or rendered as a chip.
   * `canonicalMentions` repeats that to a fixpoint, so a flattened token
   * cannot hand its brackets to the text around it and re-form a token
   * nobody resolved. The result is checked again, since a longer real
   * username can push a body past the cap.
   */
  private async canonicalBody(
    raw: string,
    workspaceId: string,
  ): Promise<string> {
    const ids = [
      ...new Set(
        extractMentionedUserIds(raw)
          .filter((id) => /^[1-9]\d*$/.test(id))
          .map(Number)
          .filter((id) => Number.isSafeInteger(id)),
      ),
    ];
    const users =
      ids.length === 0
        ? []
        : await this.prisma.user.findMany({
            where: {
              id: { in: ids },
              workspaceMembers: { some: { workspaceId } },
            },
            select: { id: true, username: true },
          });
    const names = new Map(users.map((u) => [String(u.id), u.username]));
    const body = canonicalMentions(raw, names);
    if (body === null) {
      throw new BadRequestException('Message body has malformed mentions');
    }
    return checkBody(body);
  }

  /**
   * Runs after a post has committed and been announced: mentions and thread
   * replies reach the bell. Each mentioned user is classified with
   * `mentionOutcome` against their own access, so a private channel or a DM
   * never leaks to somebody outside it. A notification failure is logged and
   * swallowed — the message is already posted, and failing the request would
   * invite a retry that posts it twice.
   */
  private async afterPost(
    message: ChatMessageDto,
    channel: ChatChannel,
    ctx: AccessContext,
  ): Promise<void> {
    const actorId = message.author?.id;
    if (actorId === undefined) return;
    try {
      const mentioned = [
        ...new Set(
          extractMentionedUserIds(message.body)
            .map(Number)
            .filter((id) => Number.isSafeInteger(id) && id > 0)
            .filter((id) => id !== actorId),
        ),
      ];
      let recipients: number[] = [];
      if (mentioned.length > 0) {
        const [workspaceMembers, channelMembers] = await Promise.all([
          this.prisma.workspaceMember.findMany({
            where: {
              workspaceId: channel.workspaceId,
              userId: { in: mentioned },
            },
            select: { userId: true },
          }),
          this.prisma.chatChannelMember.findMany({
            where: { channelId: channel.id, userId: { in: mentioned } },
            select: { userId: true },
          }),
        ]);
        const inWorkspace = new Set(workspaceMembers.map((m) => m.userId));
        const inChannel = new Set(channelMembers.map((m) => m.userId));
        // 'notify' and 'notify-preview' both produce a chat_mention row.
        recipients = mentioned.filter(
          (id) =>
            mentionOutcome({
              kind: ctx.kind,
              archived: ctx.archived,
              isWorkspaceMember: inWorkspace.has(id),
              isChannelMember: inChannel.has(id),
            }) !== 'none',
        );
        await this.notifications.createChatMention({
          workspaceId: channel.workspaceId,
          actorId,
          channelId: channel.id,
          messageId: message.id,
          threadRootId: message.threadRootId,
          recipients,
          // Raw body: the service flattens mention tokens and sanitizes.
          preview: message.body,
        });
      }
      if (message.threadRootId !== null) {
        await this.notifications.createChatThreadReply({
          workspaceId: channel.workspaceId,
          actorId,
          channelId: channel.id,
          messageId: message.id,
          threadRootId: message.threadRootId,
          preview: message.body,
          excludeUserIds: mentioned,
        });
      }
    } catch (err) {
      this.logger.warn(`chat notify failed for ${message.id}: ${String(err)}`);
    }
  }
}
