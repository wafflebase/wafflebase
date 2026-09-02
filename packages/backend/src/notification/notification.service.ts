import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotificationHub, NotificationSummary } from './notification-hub';
import { CommentNotificationDto } from './notification.dto';

/** One report may not fan out further than this. */
export const MAX_RECIPIENTS = 20;
/** Previews are a dropdown line, not the comment. */
export const MAX_PREVIEW_LENGTH = 200;
/** Page size of the dropdown. */
export const LIST_PAGE_SIZE = 20;

/**
 * Exactly what the dropdown renders. An explicit select rather than an
 * include, so internal bookkeeping never reaches the client: `dedupeKey`
 * would hand out the shape of the unique index, and `recipientId` /
 * `workspaceId` are things the caller already knows or has no use for.
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
    const document = await this.prisma.document.findUnique({
      where: { id: dto.documentId },
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
