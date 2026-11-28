import {
  Injectable,
  ForbiddenException,
  Logger,
  NotFoundException,
  GoneException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { announceMembershipRaw } from '../chat/chat-bus';
import {
  createDefaultChannel,
  joinDefaultChannel,
} from '../chat/default-channel';
import { PrismaService } from '../database/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { stopQueuedDeliveries } from '../webhook/webhook-disable';
import { WebhookEventService } from '../webhook/webhook-event.service';
import {
  removeBotsInTx,
  WORKSPACE_CONTENT_NOTIFICATION_TYPES,
} from './bot-teardown';

export { WORKSPACE_CONTENT_NOTIFICATION_TYPES } from './bot-teardown';

/**
 * `User` columns that only the Bots section reads (`src/bot/`), left out of
 * the member list every member receives. `kind` stays, so the UI can badge a
 * bot.
 */
export const BOT_PRIVATE_FIELDS = {
  botOwnerId: true,
  botWorkspaceId: true,
  botInvokers: true,
  botLastSeenAt: true,
} as const satisfies Prisma.UserOmit;

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    private prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly webhookEvents: WebhookEventService,
  ) {}

  async create(userId: number, data: { name: string }) {
    const slug = await this.generateUniqueSlug(data.name);
    return this.prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: { name: data.name, slug },
      });
      await tx.workspaceMember.create({
        data: { workspaceId: workspace.id, userId, role: 'owner' },
      });
      await createDefaultChannel(tx, workspace.id, userId);
      // A brand-new workspace has no webhook yet, so this reaches nobody
      // today. Emitted anyway: every path that creates a membership emits,
      // so none can be the one that silently does not.
      await this.webhookEvents.emitMemberEvent(tx, {
        type: 'member.joined',
        workspaceId: workspace.id,
        actor: userId,
        userId,
        role: 'owner',
      });
      return workspace;
    });
  }

  async findAllByUser(userId: number) {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
    });
    return memberships.map((m) => m.workspace);
  }

  /**
   * The user's `(workspaceId, role)` across every workspace they belong to.
   * Lets callers resolve per-workspace ownership without an N+1 of
   * `assertMember` — e.g. the documents list annotating each row with whether
   * the caller may manage (delete/move) it.
   */
  async findMembershipsByUser(userId: number) {
    return this.prisma.workspaceMember.findMany({
      where: { userId },
      select: { workspaceId: true, role: true },
    });
  }

  async findOne(idOrSlug: string, userId: number) {
    const isUUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        idOrSlug,
      );
    const workspace = await this.prisma.workspace.findUnique({
      where: isUUID ? { id: idOrSlug } : { slug: idOrSlug },
      include: {
        members: { include: { user: { omit: BOT_PRIVATE_FIELDS } } },
      },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    const isMember = workspace.members.some((m) => m.userId === userId);
    if (!isMember)
      throw new ForbiddenException('Not a member of this workspace');
    return workspace;
  }

  async update(
    workspaceId: string,
    userId: number,
    data: { name?: string; slug?: string },
  ) {
    await this.assertOwner(workspaceId, userId);
    return this.prisma.workspace.update({
      where: { id: workspaceId },
      data,
    });
  }

  async remove(workspaceId: string, userId: number) {
    await this.assertOwner(workspaceId, userId);
    const workspaceCount = await this.prisma.workspaceMember.count({
      where: { userId },
    });
    if (workspaceCount <= 1) {
      throw new ForbiddenException('Cannot delete your last workspace');
    }
    return this.prisma.workspace.delete({ where: { id: workspaceId } });
  }

  async removeMember(
    workspaceId: string,
    requesterId: number,
    targetUserId: number,
  ) {
    if (requesterId !== targetUserId) {
      await this.assertOwner(workspaceId, requesterId);
    }
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (member.role === 'owner' && requesterId === targetUserId) {
      throw new ForbiddenException('Owner cannot leave their own workspace');
    }
    // Removing somebody also revokes every API key they minted here. The live
    // membership check in `WorkspaceScopeGuard` already refuses such a key at
    // request time, but that is a *suspension*: re-adding the user later would
    // silently reactivate keys nobody re-issued. Revoking the rows makes the
    // removal permanent, and keeps the two halves in one transaction so a key
    // can never survive a committed removal.
    //
    // Their webhooks here are disabled in it too (`creator_removed`): a
    // webhook keeps exporting workspace data with nobody calling anything,
    // so it must not outlive the authority of whoever registered it. A
    // remaining owner takes one over by re-enabling it.
    //
    // Chat memberships go in the same transaction for the same reason: a
    // private channel's or DM's events fan out on `ChatChannelMember` rows,
    // so a row that outlived the workspace membership would keep delivering
    // that workspace's events to somebody who no longer belongs to it.
    // (Public channels fan out on workspace membership; see below.)
    const { deleted, announce } = await this.prisma.$transaction(
      async (tx) => {
        const deleted = await tx.workspaceMember.delete({
          where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
        });
        await tx.apiKey.updateMany({
          where: { workspaceId, createdBy: targetUserId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        // Like every other disable, it fails what they still had queued.
        const hooks = await tx.webhook.findMany({
          where: { workspaceId, createdBy: targetUserId, status: 'active' },
          select: { id: true },
        });
        const hookIds = hooks.map((h) => h.id);
        if (hookIds.length > 0) {
          const now = new Date();
          await tx.webhook.updateMany({
            where: { id: { in: hookIds }, status: 'active' },
            data: {
              status: 'disabled',
              disabledAt: now,
              disabledReason: 'creator_removed',
            },
          });
          await stopQueuedDeliveries(tx, hookIds, now);
        }
        await this.webhookEvents.emitMemberEvent(tx, {
          type: 'member.removed',
          workspaceId,
          actor: requesterId,
          userId: targetUserId,
          role: member.role,
        });
        const memberships = await tx.chatChannelMember.findMany({
          where: { userId: targetUserId, channel: { workspaceId } },
          select: { channelId: true },
        });
        const channelIds = memberships.map((m) => m.channelId);
        await tx.chatChannelMember.deleteMany({
          where: { userId: targetUserId, channelId: { in: channelIds } },
        });
        // Their bots here go with them (chat.md § Bot Members): a bot is
        // managed by its owner, and a bot left behind would keep its paired
        // hosts' read/write keys into a workspace the owner has left.
        for (const id of await this.removeOwnedBots(
          tx,
          workspaceId,
          targetUserId,
          requesterId,
        )) {
          if (!channelIds.includes(id)) channelIds.push(id);
        }
        // Their bell rows that quote this workspace go too: a chat row
        // quotes a channel (public ones included) and a comment row quotes a
        // document's comment thread, and they can read neither now. Rows
        // without content (a join, their own template decisions) stay.
        await tx.notification.deleteMany({
          where: {
            recipientId: targetUserId,
            workspaceId,
            type: { in: [...WORKSPACE_CONTENT_NOTIFICATION_TYPES] },
          },
        });
        // A private channel this removal empties is deleted with it. Only
        // its members can read it, so with none left its messages are
        // unreadable by anybody, nobody can rejoin or archive it, and its
        // name would stay reserved forever — the dead end
        // `ChatChannelService.leave` refuses to create. One statement, so
        // the emptiness check and the delete see the same rows. A DM keeps
        // its other participant and a public channel stays open to every
        // workspace member, so neither is touched.
        if (channelIds.length > 0) {
          await tx.chatChannel.deleteMany({
            where: {
              id: { in: channelIds },
              kind: 'private',
              members: { none: {} },
            },
          });
        }
        // A `mem` for any channel also evicts every hub's per-workspace
        // reader set, which is who hears a public channel. Somebody in no
        // channel row (a workspace from before #general) is announced
        // through one of its public channels, or their open stream would
        // keep hearing them until that cache expired.
        const announce =
          channelIds.length > 0
            ? channelIds
            : await tx.chatChannel
                .findFirst({
                  where: { workspaceId, kind: 'public' },
                  select: { id: true },
                })
                .then((c) => (c ? [c.id] : []));
        return { deleted, announce };
      },
    );
    await this.announceChatMembership(announce);
    return deleted;
  }

  /**
   * Inside `removeMember`'s transaction: remove the bots `ownerId` manages
   * in this workspace the way `BotService.remove` does (membership, keys,
   * unused pairing codes, chat rows, bell rows, `member.removed`). The bot
   * `User` rows stay so their messages keep a name. Returns the chat
   * channels the bots left, for the membership announcement.
   */
  private async removeOwnedBots(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    ownerId: number,
    actor: number,
  ): Promise<string[]> {
    const bots = await tx.user.findMany({
      where: {
        kind: 'bot',
        botOwnerId: ownerId,
        botWorkspaceId: workspaceId,
        workspaceMembers: { some: { workspaceId } },
      },
      select: { id: true },
    });
    const { channelIds } = await removeBotsInTx(tx, this.webhookEvents, {
      workspaceId,
      botIds: bots.map((b) => b.id),
      actor,
    });
    return channelIds;
  }

  /**
   * Tells every replica's chat hub that these channels' member sets changed,
   * so a removed member's open stream stops receiving them at once — and a
   * new one's starts. A raw `pg_notify` keeps `WorkspaceModule` from
   * depending on the chat module's providers.
   */
  private announceChatMembership(channelIds: string[]): Promise<void> {
    return announceMembershipRaw(this.prisma, channelIds, this.logger);
  }

  async createInvite(
    workspaceId: string,
    userId: number,
    data: { role?: string; expiration?: string },
  ) {
    await this.assertOwner(workspaceId, userId);
    const expiresAt = data.expiration
      ? this.parseExpiration(data.expiration)
      : null;
    return this.prisma.workspaceInvite.create({
      data: {
        workspaceId,
        createdBy: userId,
        role: data.role || 'member',
        expiresAt,
      },
    });
  }

  async findInvites(workspaceId: string, userId: number) {
    await this.assertOwner(workspaceId, userId);
    return this.prisma.workspaceInvite.findMany({
      where: { workspaceId },
    });
  }

  async revokeInvite(workspaceId: string, inviteId: string, userId: number) {
    await this.assertOwner(workspaceId, userId);
    // Scope the delete to the workspace the caller owns: deleting by id alone
    // would let an owner of one workspace revoke another workspace's invite.
    const resolvedId = await this.resolveId(workspaceId);
    const { count } = await this.prisma.workspaceInvite.deleteMany({
      where: { id: inviteId, workspaceId: resolvedId },
    });
    if (count === 0) throw new NotFoundException('Invite not found');
    return { id: inviteId };
  }

  async acceptInvite(token: string, userId: number) {
    const invite = await this.prisma.workspaceInvite.findUnique({
      where: { token },
    });
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      throw new GoneException('Invite has expired');
    }
    const existing = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: invite.workspaceId, userId },
      },
    });
    // Accepting is idempotent: an already-member is sent to the workspace
    // rather than erroring, so a re-visited invite link just opens it. The
    // invite never changes the role of an existing member.
    if (existing) {
      return { workspaceId: invite.workspaceId };
    }
    // Joining the workspace joins its default channel in the same
    // transaction, so nobody is a member without being in #general.
    let defaultChannelId: string | null;
    try {
      defaultChannelId = await this.prisma.$transaction(async (tx) => {
        await tx.workspaceMember.create({
          data: {
            workspaceId: invite.workspaceId,
            userId,
            role: invite.role,
          },
        });
        await this.webhookEvents.emitMemberEvent(tx, {
          type: 'member.joined',
          workspaceId: invite.workspaceId,
          actor: userId,
          userId,
          role: invite.role,
        });
        return joinDefaultChannel(tx, invite.workspaceId, userId);
      });
    } catch (err) {
      // A concurrent accept (double-click, two tabs) can create the row
      // between the check above and here; treat the unique-constraint clash
      // as an idempotent success rather than surfacing a 500.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return { workspaceId: invite.workspaceId };
      }
      throw err;
    }
    if (defaultChannelId) {
      await this.announceChatMembership([defaultChannelId]);
    }

    // Only a genuinely new membership notifies — both idempotent paths above
    // return before reaching here. Joining must not fail because the
    // notification write did, so this is best-effort.
    try {
      await this.notifications.createMemberJoined({
        workspaceId: invite.workspaceId,
        joinerId: userId,
        inviteCreatorId: invite.createdBy,
      });
    } catch (err) {
      this.logger.warn(
        `member-joined notification failed for workspace=${invite.workspaceId}: ${err}`,
      );
    }
    return { workspaceId: invite.workspaceId };
  }

  async resolveId(idOrSlug: string): Promise<string> {
    const isUUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        idOrSlug,
      );
    if (isUUID) return idOrSlug;
    const workspace = await this.prisma.workspace.findUnique({
      where: { slug: idOrSlug },
      select: { id: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    return workspace.id;
  }

  async assertMember(workspaceId: string, userId: number) {
    const resolvedId = await this.resolveId(workspaceId);
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: resolvedId, userId } },
    });
    if (!member) throw new ForbiddenException('Not a member of this workspace');
    return member;
  }

  async assertOwner(workspaceId: string, userId: number) {
    const resolvedId = await this.resolveId(workspaceId);
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: resolvedId, userId } },
    });
    if (!member || member.role !== 'owner') {
      throw new ForbiddenException(
        'Only workspace owner can perform this action',
      );
    }
    return member;
  }

  private parseExpiration(expiration: string): Date {
    const match = expiration.match(/^(\d+)([hd])$/);
    if (!match) throw new Error('Invalid expiration format');
    const [, value, unit] = match;
    const ms =
      unit === 'h' ? Number(value) * 3600000 : Number(value) * 86400000;
    return new Date(Date.now() + ms);
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private async generateUniqueSlug(name: string): Promise<string> {
    // Names with no ASCII alphanumerics (e.g. all-CJK or emoji) reduce to an
    // empty string, which would produce an unroutable `/w/` slug. Fall back to
    // a neutral base so the slug is always non-empty and well-formed.
    const base = this.generateSlug(name) || 'workspace';
    const existing = await this.prisma.workspace.findUnique({
      where: { slug: base },
    });
    if (!existing) return base;

    const suffix = Math.random().toString(36).slice(2, 6);
    return `${base}-${suffix}`;
  }
}
