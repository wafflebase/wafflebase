import { useCallback, useEffect, useState } from 'react';

import type { PdfCommentStore } from './pdf-comment-store.ts';
import type {
  CommentAuthor,
  PdfAnchor,
  Thread,
} from '@/types/comments.ts';
import { notifyCommentEvent } from '@/components/comments/notify.ts';

/**
 * Subscribes a React tree to a `PdfCommentStore` and exposes the mutation
 * surface the pin layer + side panel need. Presence and byte serving are
 * handled elsewhere; this hook is only about comment threads.
 *
 * `documentId` enables notification reports. Omitted (an anonymous
 * share-link session) simply means no reports.
 */
export function usePdfComments(
  store: PdfCommentStore | null,
  documentId?: string,
) {
  const [threads, setThreads] = useState<Thread<PdfAnchor>[]>([]);

  const refresh = useCallback(() => {
    if (!store) {
      setThreads([]);
      return;
    }
    void store.listThreads().then(setThreads);
  }, [store]);

  useEffect(() => {
    if (!store) return;
    refresh();
    return store.subscribe(refresh);
  }, [store, refresh]);

  const addThread = useCallback(
    async (anchor: PdfAnchor, body: string, author: CommentAuthor) => {
      if (!store) return null;
      const t = await store.addThread(anchor, body, author);
      notifyCommentEvent({
        event: 'thread',
        documentId,
        actorUserId: author.userId,
        thread: t,
        comment: t.comments[t.comments.length - 1],
      });
      refresh();
      return t.id;
    },
    [store, refresh, documentId],
  );

  const addReply = useCallback(
    async (threadId: string, body: string, author: CommentAuthor) => {
      if (!store) return;
      const comment = await store.addReply(threadId, body, author);
      const thread = (await store.listThreads()).find((t) => t.id === threadId);
      if (thread) {
        notifyCommentEvent({
          event: 'reply',
          documentId,
          actorUserId: author.userId,
          thread,
          comment,
        });
      }
      refresh();
    },
    [store, refresh, documentId],
  );

  const setResolved = useCallback(
    async (threadId: string, resolved: boolean, by: CommentAuthor) => {
      if (!store) return;
      await store.setThreadResolved(threadId, resolved, by);
      // Only resolving is worth a notification; reopening is not an event
      // anyone is waiting on.
      if (resolved) {
        const thread = (await store.listThreads()).find(
          (t) => t.id === threadId,
        );
        if (thread) {
          notifyCommentEvent({
            event: 'resolve',
            documentId,
            actorUserId: by.userId,
            thread,
          });
        }
      }
      refresh();
    },
    [store, refresh, documentId],
  );

  return { threads, addThread, addReply, setResolved };
}
