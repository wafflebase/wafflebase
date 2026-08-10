import {
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
 * Collapse a comment body excerpt into one safe dropdown line: control
 * characters (including the newlines a multi-line comment carries) become
 * spaces, runs of whitespace collapse, and the result is capped.
 */
export function sanitizePreview(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const flattened = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flattened ? flattened.slice(0, MAX_PREVIEW_LENGTH) : null;
}

/**
 * `thread_resolved` has no comment of its own, so it keys on the thread —
 * resolving and unresolving repeatedly still notifies once.
 */
function dedupeKeyFor(dto: CommentNotificationDto): string {
  return dto.type === 'thread_resolved'
    ? `${dto.threadId}:resolved`
    : (dto.commentId ?? `${dto.threadId}:${dto.type}`);
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

  async list(recipientId: number, before?: Date) {
    return this.prisma.notification.findMany({
      where: before
        ? { recipientId, createdAt: { lt: before } }
        : { recipientId },
      orderBy: { createdAt: 'desc' },
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
        orderBy: { createdAt: 'desc' },
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

    await Promise.all(
      unique(rows.map((r) => r.recipientId as number)).map((id) =>
        this.publishSummary(id),
      ),
    );
    return { created: count };
  }

  private async publishSummary(recipientId: number): Promise<void> {
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
