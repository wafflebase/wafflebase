import type { Comment } from './types';
import { extractMentionedUserIds, mentionBodyToPlainText } from './mentions';

/**
 * Which notifications a comment write should produce.
 *
 * This rule has two writers — the editor (`components/comments/notify.ts`,
 * which reports what the browser observed) and the backend's `/api/v1` comment
 * routes, which write comments of their own. Both decide *the same thing*: who
 * a comment tells, and what excerpt they see. Stating it twice made the two
 * disagree on the preview (raw `@[name](id)` markup versus the flattened
 * `@name`), so a mention notification looked different depending on which
 * client authored the comment. It lives here, beside `Comment` itself, because
 * this is the lowest package both of those callers already depend on.
 *
 * Pure and transport-free: the caller turns a plan into a request or a service
 * call. The backend re-checks workspace membership and re-applies its own
 * recipient cap either way, so this only decides intent, and an event with
 * nobody to notify costs no work at all.
 */

/** The notification types a comment event can produce. */
export type CommentNotificationType =
  | 'comment_mention'
  | 'comment_reply'
  | 'thread_resolved';

/** `thread` opens a conversation, `reply` appends, `resolve` closes it. */
export type CommentEventKind = 'thread' | 'reply' | 'resolve';

export type CommentNotificationPlan = {
  type: CommentNotificationType;
  documentId: string;
  threadId: string;
  commentId?: string;
  recipientUserIds: number[];
  preview: string;
};

/** Matches the backend's cap, so a request is never rejected for length. */
export const MAX_COMMENT_PREVIEW_LENGTH = 200;

/**
 * `CommentAuthor.userId` is a string because the comment model is shared with
 * anonymous share-link sessions, but a notification recipient must be a real
 * `User.id`. Anything that is not a plain positive integer — an anonymous
 * author, a legacy id — is simply not notifiable.
 */
export function toNotifiableUserId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** The stored excerpt: mentions flattened to `@username`, then truncated. */
export function commentPreview(body: string): string {
  return mentionBodyToPlainText(body).slice(0, MAX_COMMENT_PREVIEW_LENGTH);
}

export type CommentEvent = {
  event: CommentEventKind;
  documentId: string;
  /** The acting user's `CommentAuthor.userId`. */
  actorUserId: string;
  /** Thread state *after* the write. */
  thread: { id: string; comments: ReadonlyArray<Comment> };
  /** The comment just written. Absent for `resolve`. */
  comment?: { id: string; body: string };
};

/**
 * Decide which notifications a comment event should produce.
 *
 * A reply notifies the thread's earlier participants, but anyone that same
 * reply *mentions* is removed from that set — otherwise one reply lands in the
 * same inbox twice. The acting user is excluded everywhere.
 */
export function planCommentNotifications(
  input: CommentEvent,
): CommentNotificationPlan[] {
  const { event, documentId, actorUserId, thread, comment } = input;
  const actor = toNotifiableUserId(actorUserId);
  // A share-link visitor has no `User` row, so nothing could authorize their
  // report. Skipping here avoids a guaranteed rejection rather than firing one
  // and swallowing it.
  if (actor === null) return [];
  const isActor = (id: number) => id === actor;

  const plans: CommentNotificationPlan[] = [];

  if (event === 'resolve') {
    const participants = uniqueUserIds(thread.comments).filter(
      (id) => !isActor(id),
    );
    if (participants.length > 0) {
      plans.push({
        type: 'thread_resolved',
        documentId,
        threadId: thread.id,
        recipientUserIds: participants,
        preview: commentPreview(thread.comments[0]?.body ?? ''),
      });
    }
    return plans;
  }

  if (!comment) return plans;

  const mentioned = extractMentionedUserIds(comment.body)
    .map(toNotifiableUserId)
    .filter((id): id is number => id !== null && !isActor(id));

  if (mentioned.length > 0) {
    plans.push({
      type: 'comment_mention',
      documentId,
      threadId: thread.id,
      commentId: comment.id,
      recipientUserIds: mentioned,
      preview: commentPreview(comment.body),
    });
  }

  if (event === 'reply') {
    const earlier = thread.comments.filter((c) => c.id !== comment.id);
    const participants = uniqueUserIds(earlier).filter(
      (id) => !isActor(id) && !mentioned.includes(id),
    );
    if (participants.length > 0) {
      plans.push({
        type: 'comment_reply',
        documentId,
        threadId: thread.id,
        commentId: comment.id,
        recipientUserIds: participants,
        preview: commentPreview(comment.body),
      });
    }
  }

  return plans;
}

function uniqueUserIds(comments: ReadonlyArray<Comment>): number[] {
  const ids: number[] = [];
  for (const c of comments) {
    const id = toNotifiableUserId(String(c.author?.userId ?? ''));
    if (id !== null && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
