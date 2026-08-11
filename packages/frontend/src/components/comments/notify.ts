import {
  reportCommentNotification,
  type CommentNotificationInput,
} from '@/api/notifications';
import type { Comment, Thread } from '@/types/comments';
import { extractMentionedUserIds, mentionBodyToPlainText } from './mentions.ts';

/** Matches the backend cap, so a request is never rejected for length. */
const MAX_PREVIEW_LENGTH = 200;

export interface CommentEvent {
  /** `thread` opens one, `reply` appends, `resolve` closes it. */
  event: 'thread' | 'reply' | 'resolve';
  documentId: string;
  /** The acting user's `CommentAuthor.userId`. */
  actorUserId: string;
  /** Thread state *after* the write. */
  thread: Thread;
  /** The comment just written. Absent for `resolve`. */
  comment?: Comment;
}

/**
 * `CommentAuthor.userId` is a string because the comment model is shared with
 * anonymous share-link sessions, but a notification recipient must be a real
 * `User.id`. Anything that is not a plain positive integer — an anonymous
 * author, a legacy id — is simply not notifiable.
 */
function toUserId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function preview(body: string): string {
  return mentionBodyToPlainText(body).slice(0, MAX_PREVIEW_LENGTH);
}

/**
 * Decide which notifications a comment event should produce.
 *
 * Pure, so the rule that actually matters is testable: a reply notifies the
 * thread's earlier participants, but anyone that same reply *mentions* is
 * removed from that set — otherwise one reply lands in the same inbox twice.
 * The acting user is excluded everywhere.
 *
 * The backend re-checks membership and re-applies its own caps; this only
 * decides intent, so an event with nobody to notify costs no request at all.
 */
export function planCommentNotifications(
  input: CommentEvent,
): CommentNotificationInput[] {
  const { event, documentId, actorUserId, thread, comment } = input;
  const actor = toUserId(actorUserId);
  // A share-link visitor has no `User` row, so the backend could never
  // authorize their report. Skipping here avoids a guaranteed 401 rather
  // than firing one and swallowing it.
  if (actor === null) return [];
  const isActor = (id: number) => id === actor;

  const plans: CommentNotificationInput[] = [];

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
        preview: preview(thread.comments[0]?.body ?? ''),
      });
    }
    return plans;
  }

  if (!comment) return plans;

  const mentioned = extractMentionedUserIds(comment.body)
    .map(toUserId)
    .filter((id): id is number => id !== null && !isActor(id));

  if (mentioned.length > 0) {
    plans.push({
      type: 'comment_mention',
      documentId,
      threadId: thread.id,
      commentId: comment.id,
      recipientUserIds: mentioned,
      preview: preview(comment.body),
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
        preview: preview(comment.body),
      });
    }
  }

  return plans;
}

/**
 * Report a comment event. Fire-and-forget by design: the comment is already
 * committed to the CRDT, so a failed notification must never surface an error
 * to the author or block the UI.
 *
 * `documentId` is optional so callers can pass theirs through unconditionally;
 * without one there is nothing to attribute a notification to (an anonymous
 * share-link session), and this is a no-op.
 */
export function notifyCommentEvent(
  input: Omit<CommentEvent, 'documentId'> & { documentId?: string },
): void {
  if (!input.documentId) return;
  for (const plan of planCommentNotifications({
    ...input,
    documentId: input.documentId,
  })) {
    void reportCommentNotification(plan).catch((err: unknown) => {
      console.warn('[notifications] report failed', err);
    });
  }
}

function uniqueUserIds(comments: ReadonlyArray<Comment>): number[] {
  const ids: number[] = [];
  for (const c of comments) {
    const id = toUserId(c.author.userId);
    if (id !== null && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
