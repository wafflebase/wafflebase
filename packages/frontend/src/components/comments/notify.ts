import {
  reportCommentNotification,
  type CommentNotificationInput,
} from '@/api/notifications';
import type { Comment, Thread } from '@/types/comments';
import { planCommentNotifications as planShared } from '@wafflebase/sheets';

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
 * Decide which notifications a comment event should produce.
 *
 * The rule itself is `@wafflebase/sheets`' `planCommentNotifications` — a
 * reply notifies the thread's earlier participants minus anyone that same
 * reply *mentions*, and the actor is excluded everywhere — shared with the
 * backend's `/api/v1` comment routes, which write comments of their own and
 * have to reach the same answer. This is the browser's adapter onto it: the
 * `Thread` here carries anchor variants sheets does not know, and the request
 * body is the frontend's `CommentNotificationInput`.
 *
 * The backend re-checks membership and re-applies its own caps; this only
 * decides intent, so an event with nobody to notify costs no request at all.
 */
export function planCommentNotifications(
  input: CommentEvent,
): CommentNotificationInput[] {
  return planShared({
    event: input.event,
    documentId: input.documentId,
    actorUserId: input.actorUserId,
    thread: { id: input.thread.id, comments: input.thread.comments },
    comment: input.comment,
  });
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
