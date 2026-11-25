import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ChatChannel, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  AccessContext,
  canManage,
  canPost,
  canRead,
  canRemove,
} from './chat-access';
import { ChatBus } from './chat-bus';
import { ChannelKind, ChannelMember, ChannelSummary } from './chat.types';
import { dmKey } from './dm-key';
import { ensureDefaultChannel, joinDefaultChannel } from './default-channel';

/** A DM holds the caller plus 1–7 others. */
const DM_MIN_MEMBERS = 2;
const DM_MAX_MEMBERS = 8;

const CHANNEL_NAME = /^[a-z0-9가-힣][a-z0-9가-힣_-]{0,79}$/;

/**
 * Names are unique across a workspace's channels of every kind, private ones
 * included (Slack refuses a taken private name the same way), so a refusal
 * tells the caller a name is reserved and nothing about the channel holding
 * it. The message does not echo the name back.
 */
const TAKEN_NAME = 'That channel name is taken';

/**
 * Slack-style channel names: trimmed, lower-cased, whitespace runs turned
 * into a dash. Normalizing before the unique index sees the name is what
 * makes "Q4 Planning" and "q4-planning" one channel rather than two.
 */
export function normalizeChannelName(raw: string): string {
  const name = raw.trim().toLowerCase().replace(/\s+/g, '-');
  if (!CHANNEL_NAME.test(name)) {
    throw new BadRequestException(
      'Channel name must be 1–80 letters, digits, "-" or "_", starting with a letter or digit',
    );
  }
  return name;
}

/**
 * Somebody just lost a channel. Where that means they can no longer read it —
 * a private channel; never a public one, which stays readable to every
 * workspace member — their bell rows quoting it go too, so a preview of a
 * channel they are out of does not outlive their access. Inside the caller's
 * transaction, so the membership and its previews leave together.
 */
async function dropUnreadableChatRows(
  tx: Prisma.TransactionClient,
  channel: ChatChannel,
  userId: number,
): Promise<void> {
  if (channel.kind === 'public') return;
  await tx.notification.deleteMany({
    where: {
      recipientId: userId,
      workspaceId: channel.workspaceId,
      threadId: channel.id,
      type: { in: ['chat_mention', 'chat_thread_reply'] },
    },
  });
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

type SummaryRow = {
  id: string;
  kind: ChannelKind;
  name: string | null;
  topic: string | null;
  archived: boolean;
  isDefault: boolean;
  isMember: boolean;
  isCreator: boolean;
  isWorkspaceMember: boolean;
  isWorkspaceOwner: boolean;
  lastMessageAt: Date | null;
  lastSeq: bigint;
  lastReadSeq: bigint | null;
  unreadCount: number;
  mentionCount: number;
};

/**
 * Channels, DMs and their membership. Every route lands here (or in
 * `ChatMessageService` via `resolve`) to answer "may this user see this
 * channel"; the rule itself lives in `chat-access.ts`. A channel the caller
 * cannot see is a 404 throughout, so its existence is not disclosed.
 *
 * Membership checks go through Prisma rather than `WorkspaceService`, which
 * would make `ChatModule` depend on `WorkspaceModule` while the workspace
 * service already reaches into chat tables on member removal.
 */
@Injectable()
export class ChatChannelService {
  private readonly logger = new Logger(ChatChannelService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: ChatBus,
  ) {}

  /**
   * Resolves a workspace id or slug the caller belongs to. Not a member — or
   * no such workspace — is the same 404, as everywhere else in chat.
   */
  async assertWorkspaceMember(
    userId: number,
    workspaceIdOrSlug: string,
  ): Promise<{ workspaceId: string; role: string }> {
    const member = await this.prisma.workspaceMember.findFirst({
      where: {
        userId,
        workspace: {
          OR: [{ id: workspaceIdOrSlug }, { slug: workspaceIdOrSlug }],
        },
      },
      select: { workspaceId: true, role: true },
    });
    if (!member) throw new NotFoundException('Workspace not found');
    return member;
  }

  async list(userId: number, workspaceId: string): Promise<ChannelSummary[]> {
    const { workspaceId: id } = await this.assertWorkspaceMember(
      userId,
      workspaceId,
    );
    const where = Prisma.sql`c."workspaceId" = ${id}`;
    const rows = await this.summaries(userId, where);
    const fallback = rows.find((r) => r.isDefault);
    if (fallback?.isMember) return rows;
    // Every member belongs to #general, but a pod from before defaults
    // existed can create a workspace or accept an invite without it during
    // a rolling deploy. Reading the list repairs that, so nothing has to
    // run the backfill again by hand.
    const healed = fallback
      ? await this.prisma.$transaction((tx) =>
          joinDefaultChannel(tx, id, userId),
        )
      : await this.prisma.$transaction((tx) => ensureDefaultChannel(tx, id));
    if (!healed) return rows;
    await this.announceMembership(healed);
    return this.summaries(userId, where);
  }

  async create(
    userId: number,
    workspaceId: string,
    data: { kind: 'public' | 'private'; name: string; topic?: string },
  ): Promise<ChannelSummary> {
    const { workspaceId: id } = await this.assertWorkspaceMember(
      userId,
      workspaceId,
    );
    const name = normalizeChannelName(data.name);
    let channel: ChatChannel;
    try {
      channel = await this.prisma.chatChannel.create({
        data: {
          workspaceId: id,
          kind: data.kind,
          name,
          topic: data.topic?.trim() || null,
          createdBy: userId,
          members: { create: { userId } },
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(TAKEN_NAME);
      }
      throw err;
    }
    await this.announceMembership(channel.id);
    return this.summaryOf(userId, channel.id);
  }

  /**
   * Opens the DM between the caller and `userIds`, creating it the first
   * time. Two people opening the same DM at once both try the insert; the
   * unique `dmKey` lets exactly one win, and the loser reads the winner's
   * row, so both land in one channel.
   */
  async openDm(
    userId: number,
    workspaceId: string,
    userIds: number[],
  ): Promise<ChannelSummary> {
    const { workspaceId: id } = await this.assertWorkspaceMember(
      userId,
      workspaceId,
    );
    const ids = [...new Set([userId, ...userIds])];
    if (ids.length < DM_MIN_MEMBERS || ids.length > DM_MAX_MEMBERS) {
      throw new BadRequestException(
        `A direct message needs ${DM_MIN_MEMBERS}–${DM_MAX_MEMBERS} people including you`,
      );
    }
    const inWorkspace = await this.prisma.workspaceMember.count({
      where: { workspaceId: id, userId: { in: ids } },
    });
    if (inWorkspace !== ids.length) {
      throw new BadRequestException(
        'Everyone in a direct message must be a member of this workspace',
      );
    }

    const key = dmKey(id, ids);
    const existing = await this.prisma.chatChannel.findUnique({
      where: { dmKey: key },
      select: { id: true, lastSeq: true },
    });
    if (existing) {
      // A DM's identity is its key, but its member rows are not permanent:
      // removing someone from the workspace deletes them. Everyone here was
      // just checked to be a workspace member again, so restore the set.
      // A restored member starts at the tail, as a joiner does: the history
      // stays theirs to scroll (a DM's people are fixed, so it was written
      // to them), but what arrived while they were gone is not unread, and
      // its mentions were never theirs to be counted.
      const { count } = await this.prisma.chatChannelMember.createMany({
        data: ids.map((memberId) => ({
          channelId: existing.id,
          userId: memberId,
          lastReadSeq: existing.lastSeq,
        })),
        skipDuplicates: true,
      });
      if (count > 0) await this.announceMembership(existing.id);
      return this.summaryOf(userId, existing.id);
    }

    let channelId: string;
    try {
      const created = await this.prisma.chatChannel.create({
        data: {
          workspaceId: id,
          kind: 'dm',
          dmKey: key,
          createdBy: userId,
          members: { create: ids.map((memberId) => ({ userId: memberId })) },
        },
        select: { id: true },
      });
      channelId = created.id;
      await this.announceMembership(channelId);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const winner = await this.prisma.chatChannel.findUniqueOrThrow({
        where: { dmKey: key },
        select: { id: true },
      });
      channelId = winner.id;
    }
    return this.summaryOf(userId, channelId);
  }

  /** Join a public channel. Joining one you are already in is a no-op. */
  async join(userId: number, channelId: string): Promise<ChannelSummary> {
    const { channel, ctx } = await this.resolve(userId, channelId);
    if (channel.kind !== 'public') {
      throw new BadRequestException('Only public channels can be joined');
    }
    if (!canPost(ctx)) throw new ConflictException('Channel is archived');
    if (!ctx.isChannelMember) {
      // A newcomer starts at the tail: history from before they joined is
      // not unread, and its mentions were not addressed to a member.
      await this.prisma.chatChannelMember.createMany({
        data: [{ channelId, userId, lastReadSeq: channel.lastSeq }],
        skipDuplicates: true,
      });
      await this.announceMembership(channelId);
    }
    return this.summaryOf(userId, channelId);
  }

  /**
   * Add workspace members to a public or private channel. Only a channel
   * member may invite; a DM's member set is its identity, so it is fixed.
   */
  async invite(
    userId: number,
    channelId: string,
    inviteeIds: number[],
  ): Promise<ChannelSummary> {
    const { channel, ctx } = await this.resolve(userId, channelId);
    if (channel.kind === 'dm') {
      throw new BadRequestException(
        'A direct message has a fixed set of people; open a new one instead',
      );
    }
    if (!ctx.isChannelMember) {
      throw new ForbiddenException('Join the channel before inviting others');
    }
    if (!canPost(ctx)) throw new ConflictException('Channel is archived');

    const ids = [...new Set(inviteeIds)];
    const inWorkspace = await this.prisma.workspaceMember.count({
      where: { workspaceId: channel.workspaceId, userId: { in: ids } },
    });
    if (inWorkspace !== ids.length) {
      throw new BadRequestException(
        'Only members of this workspace can be invited',
      );
    }
    const { count } = await this.prisma.chatChannelMember.createMany({
      data: ids.map((id) => ({
        channelId,
        userId: id,
        lastReadSeq: channel.lastSeq,
      })),
      skipDuplicates: true,
    });
    if (count > 0) await this.announceMembership(channelId);
    return this.summaryOf(userId, channelId);
  }

  /**
   * Leave a public or private channel. Leaving one you are not in is a no-op.
   *
   * The last member of a private channel is refused: `canRead` needs channel
   * membership there, so an empty private channel can never be read,
   * rejoined, managed or deleted, and its name stays taken. Archiving is the
   * way out, and every member of a private channel may archive it
   * (`canManage`), so the refusal is never a dead end. The channel row is locked so two last members leaving at once
   * cannot both see the other still in it.
   */
  async leave(userId: number, channelId: string): Promise<void> {
    const { channel } = await this.resolve(userId, channelId);
    if (channel.kind === 'dm') {
      throw new BadRequestException('A direct message cannot be left');
    }
    if (channel.defaultKey !== null) {
      throw new BadRequestException(
        "Everyone in the workspace is in this channel, so it can't be left",
      );
    }
    const count = await this.prisma.$transaction(async (tx) => {
      if (channel.kind === 'private') {
        await tx.$queryRaw`
          SELECT id FROM "ChatChannel" WHERE id = ${channelId} FOR UPDATE`;
      }
      const { count: removed } = await tx.chatChannelMember.deleteMany({
        where: { channelId, userId },
      });
      if (
        removed > 0 &&
        channel.kind === 'private' &&
        (await tx.chatChannelMember.count({ where: { channelId } })) === 0
      ) {
        throw new ConflictException(
          'You are the last member — archive the channel instead',
        );
      }
      if (removed > 0) await dropUnreadableChatRows(tx, channel, userId);
      return removed;
    });
    if (count > 0) await this.announceMembership(channelId);
  }

  /**
   * Remove somebody else from a public or private channel: its creator or a
   * workspace owner, and an owner only by another owner (`canRemove`).
   * Removing yourself is leaving, which has its own route and rules; a DM's
   * member set is its identity, and everyone is in the default channel.
   *
   * Like `leave`, an emptied private channel is refused under the channel
   * row's lock. The caller is a member of a private channel they can read,
   * so only a leave racing this removal can get there.
   */
  async removeMember(
    userId: number,
    channelId: string,
    targetId: number,
    workspaceIdOrSlug: string,
  ): Promise<void> {
    const { channel, ctx } = await this.resolve(
      userId,
      channelId,
      workspaceIdOrSlug,
    );
    if (channel.kind === 'dm') {
      throw new BadRequestException(
        'A direct message has a fixed set of people; open a new one instead',
      );
    }
    if (channel.defaultKey !== null) {
      throw new BadRequestException(
        'Everyone in the workspace is in this channel, so nobody can be removed from it',
      );
    }
    if (targetId === userId) {
      throw new BadRequestException(
        'To leave a channel, use DELETE .../members/me',
      );
    }
    const [callerRole, targetRole] = await Promise.all(
      [userId, targetId].map((id) =>
        this.workspaceRole(channel.workspaceId, id),
      ),
    );
    const allowed = canRemove({
      ...ctx,
      isCreator: channel.createdBy === userId,
      isWorkspaceOwner: callerRole === 'owner',
      targetIsWorkspaceOwner: targetRole === 'owner',
    });
    if (!allowed) {
      throw new ForbiddenException(
        targetRole === 'owner' && callerRole !== 'owner'
          ? 'Only a workspace owner can remove a workspace owner'
          : "Only the channel's creator or a workspace owner can remove people from it",
      );
    }
    await this.prisma.$transaction(async (tx) => {
      if (channel.kind === 'private') {
        await tx.$queryRaw`
          SELECT id FROM "ChatChannel" WHERE id = ${channelId} FOR UPDATE`;
      }
      const { count } = await tx.chatChannelMember.deleteMany({
        where: { channelId, userId: targetId },
      });
      if (count === 0) {
        throw new NotFoundException('That person is not in this channel');
      }
      await dropUnreadableChatRows(tx, channel, targetId);
      if (
        channel.kind === 'private' &&
        (await tx.chatChannelMember.count({ where: { channelId } })) === 0
      ) {
        throw new ConflictException(
          'That would leave the channel empty — archive it instead',
        );
      }
    });
    await this.announceMembership(channelId);
  }

  /**
   * Rename, set the topic, archive or unarchive. Public: creator or workspace
   * owner. Private: any channel member (see `canManage`).
   */
  async update(
    userId: number,
    channelId: string,
    data: { name?: string; topic?: string; archived?: boolean },
  ): Promise<ChannelSummary> {
    const { channel, ctx } = await this.resolve(userId, channelId);
    if (channel.kind === 'dm') {
      throw new BadRequestException(
        'A direct message cannot be renamed or archived',
      );
    }
    await this.assertCanManage(
      userId,
      channel,
      ctx,
      "Only the channel's creator or a workspace owner can change it",
    );

    if (data.archived && channel.defaultKey !== null) {
      throw new BadRequestException(
        "The workspace's default channel can't be archived",
      );
    }

    const name =
      data.name !== undefined ? normalizeChannelName(data.name) : undefined;
    const patch: Prisma.ChatChannelUpdateInput = { name };
    if (data.topic !== undefined) patch.topic = data.topic.trim() || null;
    if (data.archived !== undefined) {
      // Keep the original archive time when archiving twice.
      patch.archivedAt = data.archived
        ? (channel.archivedAt ?? new Date())
        : null;
    }
    try {
      await this.prisma.chatChannel.update({
        where: { id: channelId },
        data: patch,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(TAKEN_NAME);
      }
      throw err;
    }
    return this.summaryOf(userId, channelId);
  }

  /**
   * Who is in a public or private channel, by username. A DM's members
   * already travel on its summary. Readable by anyone who can read the
   * channel: a public channel's membership is no secret from the workspace,
   * and a private one is only readable by its members.
   */
  async members(
    userId: number,
    channelId: string,
    workspaceIdOrSlug: string,
  ): Promise<ChannelMember[]> {
    const { channel, ctx } = await this.resolve(
      userId,
      channelId,
      workspaceIdOrSlug,
    );
    if (channel.kind === 'dm') {
      throw new BadRequestException(
        "A direct message's members are on its summary",
      );
    }
    const rows = await this.prisma.chatChannelMember.findMany({
      // A row that outlived its workspace membership grants nothing (see
      // `ChatHub.membersOf`), so it does not list anybody either.
      where: {
        channelId,
        user: {
          workspaceMembers: { some: { workspaceId: channel.workspaceId } },
        },
      },
      select: {
        user: {
          select: {
            id: true,
            username: true,
            photo: true,
            workspaceMembers: {
              where: { workspaceId: channel.workspaceId },
              select: { role: true },
            },
          },
        },
      },
      orderBy: { user: { username: 'asc' } },
    });
    // The rule `removeMember` enforces, per row, so the dialog offers Remove
    // exactly where the server will accept it.
    const callerRole = await this.workspaceRole(channel.workspaceId, userId);
    return rows.map(({ user: { workspaceMembers, ...user } }) => ({
      ...user,
      canRemove:
        user.id !== userId &&
        channel.defaultKey === null &&
        canRemove({
          ...ctx,
          isCreator: channel.createdBy === userId,
          isWorkspaceOwner: callerRole === 'owner',
          targetIsWorkspaceOwner: workspaceMembers[0]?.role === 'owner',
        }),
    }));
  }

  /**
   * Loads a channel and the facts the access policy needs, refusing with 404
   * when the caller cannot read it. `workspaceIdOrSlug`, when given, is the
   * route's workspace: a channel from another workspace is 404 under it,
   * even for somebody who belongs to both.
   */
  async resolve(
    userId: number,
    channelId: string,
    workspaceIdOrSlug?: string,
  ): Promise<{ channel: ChatChannel; ctx: AccessContext }> {
    const found = await this.prisma.chatChannel.findUnique({
      where: { id: channelId },
      include: {
        workspace: {
          select: { slug: true, members: { where: { userId } } },
        },
        members: { where: { userId }, select: { userId: true } },
      },
    });
    if (
      !found ||
      (workspaceIdOrSlug !== undefined &&
        workspaceIdOrSlug !== found.workspaceId &&
        workspaceIdOrSlug !== found.workspace.slug)
    ) {
      throw new NotFoundException('Channel not found');
    }
    const { workspace, members, ...channel } = found;
    const ctx: AccessContext = {
      kind: channel.kind as ChannelKind,
      archived: channel.archivedAt !== null,
      isWorkspaceMember: workspace.members.length > 0,
      isChannelMember: members.length > 0,
    };
    if (!canRead(ctx)) throw new NotFoundException('Channel not found');
    return { channel, ctx };
  }

  /**
   * Refuses with 403 unless `userId` passes `canManage` on a channel
   * `resolve` already loaded.
   */
  private async assertCanManage(
    userId: number,
    channel: ChatChannel,
    ctx: AccessContext,
    refusal: string,
  ): Promise<void> {
    const allowed = canManage({
      ...ctx,
      isCreator: channel.createdBy === userId,
      isWorkspaceOwner:
        (await this.workspaceRole(channel.workspaceId, userId)) === 'owner',
    });
    if (!allowed) throw new ForbiddenException(refusal);
  }

  private async workspaceRole(
    workspaceId: string,
    userId: number,
  ): Promise<string | undefined> {
    const row = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    });
    return row?.role;
  }

  /** One channel's summary as `userId` sees it. */
  async summaryOf(userId: number, channelId: string): Promise<ChannelSummary> {
    const [summary] = await this.summaries(
      userId,
      Prisma.sql`c.id = ${channelId}`,
    );
    if (!summary) throw new NotFoundException('Channel not found');
    return summary;
  }

  /**
   * The channel list query. Public channels appear whether or not the caller
   * joined; private channels and DMs only when they are a member. Unread and
   * mention counts are over top-level messages (thread replies count only
   * when also sent to the channel) that are newer than the caller's read
   * position and not their own — and are zero for a channel they are not in,
   * since there is no read position to measure from.
   */
  private async summaries(
    userId: number,
    where: Prisma.Sql,
  ): Promise<ChannelSummary[]> {
    // The canonical token `@[name](id)`, matched as `MENTION_RE` parses it,
    // so plain text such as `[docs](42)` is not a mention of user 42. The id
    // is an integer, so it needs no escaping inside the pattern.
    const mention = `@\\[[^]]*\\]\\(${userId}\\)`;
    const rows = await this.prisma.$queryRaw<SummaryRow[]>`
      SELECT c.id, c.kind, c.name, c.topic,
             c."archivedAt" IS NOT NULL AS archived,
             c."defaultKey" IS NOT NULL AS "isDefault",
             m."userId" IS NOT NULL AS "isMember",
             c."createdBy" IS NOT DISTINCT FROM ${userId} AS "isCreator",
             wm."userId" IS NOT NULL AS "isWorkspaceMember",
             wm.role IS NOT DISTINCT FROM 'owner' AS "isWorkspaceOwner",
             c."lastMessageAt",
             c."lastSeq",
             m."lastReadSeq",
             COALESCE(u.unread, 0)::int AS "unreadCount",
             COALESCE(u.mentions, 0)::int AS "mentionCount"
      FROM "ChatChannel" c
      LEFT JOIN "ChatChannelMember" m
        ON m."channelId" = c.id AND m."userId" = ${userId}
      LEFT JOIN "WorkspaceMember" wm
        ON wm."workspaceId" = c."workspaceId" AND wm."userId" = ${userId}
      LEFT JOIN LATERAL (
        SELECT count(*) AS unread,
               count(*) FILTER (WHERE x.body ~ ${mention}) AS mentions
        FROM "ChatMessage" x
        WHERE m."userId" IS NOT NULL
          AND x."channelId" = c.id
          AND x.seq > m."lastReadSeq"
          AND (x."threadRootId" IS NULL OR x."alsoInChannel")
          AND x."deletedAt" IS NULL
          AND x."authorId" IS DISTINCT FROM ${userId}
      ) u ON true
      WHERE ${where} AND (c.kind = 'public' OR m."userId" IS NOT NULL)
      ORDER BY c.kind, c.name, c."createdAt"`;

    const dmIds = rows.filter((r) => r.kind === 'dm').map((r) => r.id);
    const dmMembers = dmIds.length
      ? await this.prisma.chatChannelMember.findMany({
          where: { channelId: { in: dmIds } },
          orderBy: { userId: 'asc' },
          select: {
            channelId: true,
            user: { select: { id: true, username: true, photo: true } },
          },
        })
      : [];

    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      topic: r.topic,
      archived: r.archived,
      isDefault: r.isDefault,
      isMember: r.isMember,
      // The same policy `update` enforces, so the client offers exactly the
      // controls the server will accept.
      canManage: canManage({
        kind: r.kind,
        archived: r.archived,
        isWorkspaceMember: r.isWorkspaceMember,
        isChannelMember: r.isMember,
        isCreator: r.isCreator,
        isWorkspaceOwner: r.isWorkspaceOwner,
      }),
      members: dmMembers.filter((m) => m.channelId === r.id).map((m) => m.user),
      lastSeq: Number(r.lastSeq),
      lastReadSeq: r.lastReadSeq === null ? null : Number(r.lastReadSeq),
      unreadCount: r.unreadCount,
      mentionCount: r.mentionCount,
      lastMessageAt: r.lastMessageAt ? r.lastMessageAt.toISOString() : null,
    }));
  }

  /**
   * Tells every replica that a channel's member set changed. The change has
   * already committed, so a failed notify is logged rather than turned into
   * a failed request that the client would retry against a done change.
   */
  async announceMembership(channelId: string): Promise<void> {
    try {
      await this.bus.notifyMembership(channelId);
    } catch (err) {
      this.logger.warn(
        `chat membership notify failed for ${channelId}: ${String(err)}`,
      );
    }
  }
}
