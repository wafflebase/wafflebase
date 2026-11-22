import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotificationHub, NotificationSummary } from './notification-hub';
import { CommentNotificationDto } from './notification.dto';
import { LIVE_DOCUMENT } from '../document/live-document';
import { mentionBodyToPlainText } from '@wafflebase/sheets';
import { canRead } from '../chat/chat-access';
import { ChannelKind } from '../chat/chat.types';

/** One report may not fan out further than this. */
export const MAX_RECIPIENTS = 20;
/** Previews are a dropdown line, not the comment. */
export const MAX_PREVIEW_LENGTH = 200;
/** Page size of the dropdown. */
export const LIST_PAGE_SIZE = 20;

/**
 * Exactly what the dropdown renders. An explicit select rather than an
 * include, so internal bookkeeping never reaches the client: `dedupeKey` would
 * hand out the shape of the unique index, and `recipientId` is the caller.
 *
 * The `workspace` relation is here because a workspace-level notification has
 * no document to name: a reader of "someone joined the workspace" belongs to
 * several, and without the name the row says nothing and without the id it
 * links nowhere.
 *
 * Almost every recipient is a member of the workspace its row belongs to, so
 * the name and id are already theirs to see. `template_review_queued` is the
 * exception and is worth stating rather than glossing: it addresses the global
 * reviewer allowlist, who are members of nothing. They receive the publishing
 * workspace's name here — a deliberate widening, and a small one beside the
 * document title this row already carries and the preview token that lets a
 * reviewer open the document itself. Anything added to this select later must
 * be checked against *that* recipient, not against the membership rule.
 */
const LIST_SELECT = {
  id: true,
  type: true,
  documentId: true,
  threadId: true,
  commentId: true,
  preview: true,
  readAt: true,
  createdAt: true,
  actor: { select: { id: true, username: true, photo: true } },
  document: { select: { id: true, title: true, type: true } },
  workspace: { select: { id: true, name: true } },
} as const;

/**
 * Which notification a review decision becomes. Kept beside the creator rather
 * than in the template module: this is the notification vocabulary, and the
 * only thing that reads it is the sentence table on the client.
 */
const TEMPLATE_REVIEW_TYPES = {
  approve: 'template_approved',
  reject: 'template_rejected',
  takedown: 'template_removed',
} as const;

/**
 * Collapse a comment body excerpt into one safe dropdown line: control
 * characters (including the newlines a multi-line comment carries) become
 * spaces, runs of whitespace collapse, and the result is capped.
 */
export function sanitizePreview(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const flattened = raw
    // Invisible formatting characters are removed outright: a zero-width
    // space turned into a real space would split a word, and a bidi override
    // left in place lets a peer make the line read in an order its text does
    // not have.
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    // C0/C1 controls become spaces — the newlines of a multi-line comment
    // are word separators, not nothing.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flattened ? flattened.slice(0, MAX_PREVIEW_LENGTH) : null;
}

/**
 * `thread_resolved` has no comment of its own, so it keys on the thread —
 * resolving and unresolving repeatedly still notifies once. The other two key
 * on the comment, which the DTO makes mandatory for them: a thread-wide key
 * would be shared by every later comment and suppress all of them.
 */
function dedupeKeyFor(dto: CommentNotificationDto): string {
  if (dto.type === 'thread_resolved') return `${dto.threadId}:resolved`;
  if (!dto.commentId) {
    // Unreachable through the controller; a direct caller that skipped
    // validation gets an error rather than a silently poisoned dedupe key.
    throw new BadRequestException(`${dto.type} requires a commentId`);
  }
  return dto.commentId;
}

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hub: NotificationHub,
  ) {}

  /**
   * Record a comment event reported by the client. The body is *not* trusted
   * to say who may be notified: the actor must belong to the document's
   * workspace, and so must every recipient. See `docs/design/notifications.md`
   * for why content itself is not verified.
   */
  async createFromComment(
    actorId: number,
    dto: CommentNotificationDto,
  ): Promise<{ created: number }> {
    // A trashed document takes no new comment events (the Yorkie webhook
    // refuses its attach anyway); already-delivered rows are history and stay.
    const document = await this.prisma.document.findUnique({
      where: { id: dto.documentId, ...LIVE_DOCUMENT },
      select: { id: true, workspaceId: true },
    });
    if (!document) throw new NotFoundException('Document not found');

    const candidates = unique(dto.recipientUserIds).filter(
      (id) => id !== actorId,
    );
    const memberIds = await this.memberIdsAmong(document.workspaceId, [
      actorId,
      ...candidates,
    ]);
    if (!memberIds.has(actorId)) {
      throw new ForbiddenException('Not a member of this workspace');
    }

    // A recipient who has left the workspace is dropped rather than rejected:
    // one stale id must not fail the whole report.
    const recipients = candidates
      .filter((id) => memberIds.has(id))
      .slice(0, MAX_RECIPIENTS);

    return this.insert(
      recipients.map((recipientId) => ({
        type: dto.type,
        recipientId,
        actorId,
        workspaceId: document.workspaceId,
        documentId: document.id,
        threadId: dto.threadId,
        commentId: dto.commentId ?? null,
        dedupeKey: dedupeKeyFor(dto),
        preview: sanitizePreview(dto.preview),
      })),
    );
  }

  /**
   * Someone accepted an invite link. Unlike comment events this is created
   * server-side, inside `WorkspaceService.acceptInvite`, where the backend
   * already knows what happened.
   */
  async createMemberJoined(input: {
    workspaceId: string;
    joinerId: number;
    inviteCreatorId: number;
  }): Promise<{ created: number }> {
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId: input.workspaceId },
      select: { userId: true, role: true },
    });
    const owners = members
      .filter((m) => m.role === 'owner')
      .map((m) => m.userId);
    const recipients = unique([...owners, input.inviteCreatorId]).filter(
      (id) => id !== input.joinerId,
    );

    return this.insert(
      recipients.map((recipientId) => ({
        type: 'workspace_member_joined',
        recipientId,
        actorId: input.joinerId,
        workspaceId: input.workspaceId,
        documentId: null,
        threadId: null,
        commentId: null,
        // Null, so re-joining a workspace notifies again (Postgres treats
        // NULLs as distinct in a unique index).
        dedupeKey: null,
        preview: null,
      })),
    );
  }

  /**
   * A webhook is failing (`webhook_failing`, sent once per failure streak) or
   * was turned off (`webhook_disabled`). Created server-side by the webhook
   * delivery worker and management service.
   *
   * Addressed to **every owner**, not the creator: the creator may be the
   * reason it was disabled (`creator_removed`), and any owner can re-enable
   * it. There is no document; `threadId` carries the webhook id so the
   * client can link to its detail page, the way chat rows carry a channel.
   *
   * `dedupeKey` is `<webhookId>:<type>:<since>` — the streak start for a
   * warning, the disable instant for a disable — so a retried call creates no
   * second row while the next streak or disable still notifies.
   */
  async createWebhookAlert(input: {
    workspaceId: string;
    webhook: { id: string; name: string };
    type: 'webhook_failing' | 'webhook_disabled';
    /** Plain words, appended to the name in the preview. */
    reason: string;
    since: Date;
    /** Who caused it, when a person did (a manual disable). */
    actorId?: number | null;
  }): Promise<{ created: number }> {
    const owners = await this.prisma.workspaceMember.findMany({
      where: { workspaceId: input.workspaceId, role: 'owner' },
      select: { userId: true },
    });
    const actorId = input.actorId ?? null;
    return this.insert(
      unique(owners.map((o) => o.userId))
        .filter((id) => id !== actorId)
        .map((recipientId) => ({
          type: input.type,
          recipientId,
          actorId,
          workspaceId: input.workspaceId,
          documentId: null,
          threadId: input.webhook.id,
          commentId: null,
          dedupeKey: `${input.webhook.id}:${input.type}:${input.since.toISOString()}`,
          preview: sanitizePreview(`${input.webhook.name}: ${input.reason}`),
        })),
    );
  }

  /**
   * A reviewer decided a template submission. Created server-side, like
   * `createMemberJoined` and unlike the comment events — review happens in
   * this backend, so no client reports it.
   *
   * The **decision is the type**, not a field: `comment_mention` and
   * `comment_reply` are separate types for the same reason, because the reader
   * renders one sentence per type and "your template was reviewed" says
   * nothing. A client that has not learned these yet falls back to its generic
   * sentence rather than rendering a raw value.
   *
   * Addressed to the listing's publisher (`createdBy`), which is who submitted
   * it. A submission that disappears silently is the failure mode this pipeline
   * exists to avoid, so the reviewer's note rides along as the preview: for a
   * rejection or a takedown it is the reason, and it is the only place the
   * publisher is told one.
   *
   * `dedupeKey` carries the decision instant rather than the listing id alone.
   * The unique index would otherwise absorb the second decision on a listing
   * that was rejected, revised and rejected again — which is precisely the
   * sequence a publisher most needs to hear about.
   */
  async createTemplateReviewed(input: {
    listing: {
      id: string;
      createdBy: number;
      workspaceId: string;
      documentId: string;
    };
    reviewerId: number;
    decision: 'approve' | 'reject' | 'takedown';
    note?: string;
    /** The decision instant, so the row and its dedupe key agree. */
    decidedAt: Date;
  }): Promise<{ created: number }> {
    // A reviewer who decides their own listing is not notified, for the same
    // reason an actor never notifies themselves anywhere else here.
    if (input.listing.createdBy === input.reviewerId) return { created: 0 };

    const type = TEMPLATE_REVIEW_TYPES[input.decision];
    return this.insert([
      {
        type,
        recipientId: input.listing.createdBy,
        actorId: input.reviewerId,
        workspaceId: input.listing.workspaceId,
        documentId: input.listing.documentId,
        threadId: null,
        commentId: null,
        dedupeKey: `${input.listing.id}:${input.decidedAt.toISOString()}`,
        preview: sanitizePreview(input.note),
      },
    ]);
  }

  /**
   * An approved public listing's document was edited, so the listing left the
   * gallery and is waiting to be reviewed again.
   *
   * The publisher caused it, but they did not necessarily know it would happen
   * — the edit was to their document, not to the listing — so a template that
   * quietly stops being public is exactly the silent disappearance this
   * pipeline exists to avoid.
   *
   * Deduped **per day**: editing a document is not one event, and a key on the
   * listing alone would notify once ever while a per-edit key would notify on
   * every keystroke burst. One "your template is being reviewed again" a day is
   * the useful granularity.
   */
  async createTemplateNeedsReview(input: {
    listing: {
      id: string;
      createdBy: number;
      workspaceId: string;
      documentId: string;
    };
    at: Date;
  }): Promise<{ created: number }> {
    const day = input.at.toISOString().slice(0, 10);
    return this.insert([
      {
        type: 'template_needs_review',
        recipientId: input.listing.createdBy,
        // Nobody acted on the publisher's behalf; the edit was their own.
        actorId: null,
        workspaceId: input.listing.workspaceId,
        documentId: input.listing.documentId,
        threadId: null,
        commentId: null,
        dedupeKey: `${input.listing.id}:rereview:${day}`,
        preview: null,
      },
    ]);
  }

  /**
   * Something is waiting in the template review queue.
   *
   * Addressed to the reviewer allowlist, and it exists because the queue has
   * no other signal: `/admin/templates` is a page somebody has to remember to
   * open, while submissions arrive whenever a publisher acts and re-reviews
   * arrive whenever anyone edits an approved template's document. An unwatched
   * queue means the gallery quietly empties, which is the same silent failure
   * the publisher-facing notifications exist to prevent, seen from the other
   * side.
   *
   * Deduped per listing per day, so a burst of activity is one nudge.
   */
  async createTemplateReviewQueued(input: {
    reviewerIds: number[];
    listing: { id: string; workspaceId: string; documentId: string };
    /** Who caused it, when that is a person acting deliberately. */
    actorId: number | null;
    at: Date;
  }): Promise<{ created: number }> {
    const day = input.at.toISOString().slice(0, 10);
    return this.insert(
      unique(input.reviewerIds)
        // A reviewer reviewing their own submission needs no telling.
        .filter((id) => id !== input.actorId)
        .map((recipientId) => ({
          type: 'template_review_queued',
          recipientId,
          actorId: input.actorId,
          workspaceId: input.listing.workspaceId,
          documentId: input.listing.documentId,
          threadId: null,
          commentId: null,
          dedupeKey: `${input.listing.id}:queued:${day}`,
          preview: null,
        })),
    );
  }

  /**
   * A chat message mentioned these users. Created server-side when the message
   * is posted: chat lives in Postgres, so unlike a comment there is no client
   * report to distrust.
   *
   * `recipients` arrive already authorized — the caller ran `mentionOutcome`
   * against each mentioned user's channel access, which is what keeps a
   * private channel or a DM from leaking to somebody outside it. Workspace
   * membership is checked again here anyway, so a stale or careless caller
   * still cannot address a non-member.
   *
   * The chat location rides in the existing opaque columns: the channel id in
   * `threadId` and the message id in `commentId`, which is everything
   * `notificationHref` needs. Keyed on the message, so an edit that re-runs
   * this never notifies twice.
   */
  async createChatMention(input: {
    workspaceId: string;
    actorId: number;
    channelId: string;
    messageId: string;
    threadRootId: string | null;
    recipients: number[];
    preview: string;
  }): Promise<{ created: number }> {
    const candidates = unique(input.recipients).filter(
      (id) => id !== input.actorId,
    );
    if (candidates.length === 0) return { created: 0 };
    const memberIds = await this.memberIdsAmong(input.workspaceId, candidates);
    const recipients = candidates
      .filter((id) => memberIds.has(id))
      .slice(0, MAX_RECIPIENTS);

    return this.insert(
      recipients.map((recipientId) =>
        chatRow(input, 'chat_mention', recipientId, input.messageId),
      ),
    );
  }

  /**
   * A reply was posted in a thread. Everyone already in it — the root's
   * author and anyone who replied before — hears about it, except the actor
   * and `excludeUserIds` (the users this same message already reached through
   * `createChatMention`, for whom a second row would be noise).
   *
   * Deduped **per thread per UTC hour**: a busy thread is one row an hour
   * rather than one per message, and the next hour's first reply notifies
   * again so a thread that comes back to life is not silent.
   *
   * Participation is history, not access: somebody who replied and has since
   * left a private channel, or the workspace, must not keep receiving its
   * content as previews. So every candidate is re-checked with `canRead`.
   */
  async createChatThreadReply(input: {
    workspaceId: string;
    actorId: number;
    channelId: string;
    messageId: string;
    threadRootId: string;
    preview: string;
    excludeUserIds: number[];
  }): Promise<{ created: number }> {
    const [channel, root, replies] = await Promise.all([
      this.prisma.chatChannel.findUnique({
        where: { id: input.channelId },
        select: { kind: true },
      }),
      this.prisma.chatMessage.findUnique({
        where: { id: input.threadRootId },
        select: { authorId: true },
      }),
      this.prisma.chatMessage.findMany({
        where: { threadRootId: input.threadRootId, authorId: { not: null } },
        select: { authorId: true },
        distinct: ['authorId'],
      }),
    ]);
    if (!channel || !root) return { created: 0 };

    const excluded = new Set([input.actorId, ...input.excludeUserIds]);
    const candidates = unique(
      [root.authorId, ...replies.map((r) => r.authorId)].filter(
        (id): id is number => id !== null && !excluded.has(id),
      ),
    );
    if (candidates.length === 0) return { created: 0 };

    const [workspaceMemberIds, channelMembers] = await Promise.all([
      this.memberIdsAmong(input.workspaceId, candidates),
      this.prisma.chatChannelMember.findMany({
        where: { channelId: input.channelId, userId: { in: candidates } },
        select: { userId: true },
      }),
    ]);
    const channelMemberIds = new Set(channelMembers.map((m) => m.userId));
    const recipients = candidates.filter((id) =>
      canRead({
        kind: channel.kind as ChannelKind,
        // Reading needs no write access, so archiving changes nothing here.
        archived: false,
        isWorkspaceMember: workspaceMemberIds.has(id),
        isChannelMember: channelMemberIds.has(id),
      }),
    );

    // `2026-11-21T09:41:00.000Z` → `2026-11-21T09`.
    const hour = new Date().toISOString().slice(0, 13);
    return this.insert(
      recipients.map((recipientId) =>
        chatRow(
          input,
          'chat_thread_reply',
          recipientId,
          `${input.threadRootId}:${hour}`,
        ),
      ),
    );
  }

  /**
   * One page, newest first. The cursor is the `(createdAt, id)` pair of the
   * last row of the previous page: a timestamp alone would skip every row
   * sharing the boundary instant, and one report inserts its whole batch at a
   * single instant. `id` also breaks ordering ties so paging is stable.
   */
  async list(recipientId: number, cursor?: { before: Date; id?: string }) {
    return this.prisma.notification.findMany({
      where: cursor
        ? {
            recipientId,
            OR: [
              { createdAt: { lt: cursor.before } },
              ...(cursor.id
                ? [{ createdAt: cursor.before, id: { lt: cursor.id } }]
                : []),
            ],
          }
        : { recipientId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LIST_PAGE_SIZE,
      select: LIST_SELECT,
    });
  }

  async unreadCount(recipientId: number): Promise<number> {
    return this.prisma.notification.count({
      where: { recipientId, readAt: null },
    });
  }

  /** Mark the caller's notifications read. Omitting `ids` marks all of them. */
  async markRead(recipientId: number, ids?: string[]): Promise<void> {
    await this.prisma.notification.updateMany({
      // Always scoped to the caller — an id from someone else's inbox matches
      // nothing rather than being marked read.
      where: ids
        ? { recipientId, readAt: null, id: { in: ids } }
        : { recipientId, readAt: null },
      data: { readAt: new Date() },
    });
    await this.publishSummary(recipientId);
  }

  /** Current stream summary for a user, used by the SSE poll fallback too. */
  async summaryFor(recipientId: number): Promise<NotificationSummary> {
    const [unreadCount, latest] = await Promise.all([
      this.unreadCount(recipientId),
      this.prisma.notification.findMany({
        where: { recipientId },
        // Same tiebreak as `list`. Without it two rows sharing the newest
        // `createdAt` — one report inserts its batch at a single timestamp —
        // let the planner return either, so `latestId` flips between polls and
        // the stream reads that as a change.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { id: true },
      }),
    ]);
    return { unreadCount, latestId: latest[0]?.id ?? null };
  }

  private async insert(
    rows: Array<Record<string, unknown>>,
  ): Promise<{ created: number }> {
    if (rows.length === 0) return { created: 0 };

    // `skipDuplicates` lets the unique index absorb a client retry or a
    // double submit without a round trip to check first.
    const { count } = await this.prisma.notification.createMany({
      data: rows as never,
      skipDuplicates: true,
    });

    // Nothing was written (every row was an absorbed duplicate), so no badge
    // anywhere changed.
    if (count === 0) return { created: 0 };

    await Promise.all(
      unique(rows.map((r) => r.recipientId as number)).map((id) =>
        this.publishSummary(id),
      ),
    );
    return { created: count };
  }

  /**
   * Push a fresh summary to this user's connections on this replica.
   *
   * A summary costs two queries and `publish` only reaches *local*
   * subscribers, so computing one for a user with no connection here is pure
   * waste — a 20-recipient mention would otherwise fire 40 queries, most of
   * them discarded. Users connected to another replica pick the change up
   * from that replica's poll tick.
   */
  private async publishSummary(recipientId: number): Promise<void> {
    if (this.hub.subscriberCount(recipientId) === 0) return;
    this.hub.publish(recipientId, await this.summaryFor(recipientId));
  }

  /** Which of these users belong to the workspace. */
  private async memberIdsAmong(
    workspaceId: string,
    userIds: number[],
  ): Promise<Set<number>> {
    const rows = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, userId: { in: unique(userIds) } },
      select: { userId: true },
    });
    return new Set(rows.map((r) => r.userId));
  }
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/**
 * One chat notification row. The preview is flattened before sanitizing so a
 * mention reads as `@username` rather than the raw `@[username](id)` token.
 */
function chatRow(
  input: {
    workspaceId: string;
    actorId: number;
    channelId: string;
    messageId: string;
    preview: string;
  },
  type: 'chat_mention' | 'chat_thread_reply',
  recipientId: number,
  dedupeKey: string,
): Record<string, unknown> {
  return {
    type,
    recipientId,
    actorId: input.actorId,
    workspaceId: input.workspaceId,
    documentId: null,
    threadId: input.channelId,
    commentId: input.messageId,
    dedupeKey,
    preview: sanitizePreview(mentionBodyToPlainText(input.preview)),
  };
}
