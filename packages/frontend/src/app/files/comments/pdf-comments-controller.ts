import { useCallback, useEffect, useState } from 'react';

import type { PdfCommentStore } from './pdf-comment-store.ts';
import type {
  CommentAuthor,
  PdfRegionAnchor,
  Thread,
} from '@/types/comments.ts';

/**
 * Subscribes a React tree to a `PdfCommentStore` and exposes the mutation
 * surface the pin layer + side panel need. Presence and byte serving are
 * handled elsewhere; this hook is only about comment threads.
 */
export function usePdfComments(store: PdfCommentStore | null) {
  const [threads, setThreads] = useState<Thread<PdfRegionAnchor>[]>([]);

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
    async (anchor: PdfRegionAnchor, body: string, author: CommentAuthor) => {
      if (!store) return null;
      const t = await store.addThread(anchor, body, author);
      refresh();
      return t.id;
    },
    [store, refresh],
  );

  const addReply = useCallback(
    async (threadId: string, body: string, author: CommentAuthor) => {
      if (!store) return;
      await store.addReply(threadId, body, author);
      refresh();
    },
    [store, refresh],
  );

  const setResolved = useCallback(
    async (threadId: string, resolved: boolean, by: CommentAuthor) => {
      if (!store) return;
      await store.setThreadResolved(threadId, resolved, by);
      refresh();
    },
    [store, refresh],
  );

  return { threads, addThread, addReply, setResolved };
}
