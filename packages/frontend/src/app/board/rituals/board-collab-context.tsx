import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Document } from "@yorkie-js/react";

import type { BoardAnchor, CommentAuthor, Thread } from "@/types/comments";
import type { YorkieBoardRoot } from "@/types/board-document";
import { useWorkspaceMembers } from "@/components/comments/use-workspace-members";
import { notifyCommentEvent } from "@/components/comments/notify";
import { BoardCommentStore } from "./board-comment-store";
import { createRitualTool, type RitualTool } from "./ritual-tool";
import {
  BoardCollabContext,
  type BoardCollabUser,
  type BoardCollabValue,
  type PendingBoardComment,
} from "./board-collab-hook";

function topLevelIds(doc: Document<YorkieBoardRoot>): Set<string> {
  const ids = new Set<string>();
  const elements = doc.getRoot().elements;
  if (!elements) return ids;
  for (const el of Array.from(elements)) if (el?.id) ids.add(el.id);
  return ids;
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/**
 * Board comments + the ritual tool state, shared between the header (the
 * Comments toggle), the side panel and the canvas. Mirrors
 * `PdfCollabStateProvider`: one `BoardCommentStore` over the attached
 * document, threads re-read on content changes, and every write reported
 * to `/notifications/comment` through the shared `notifyCommentEvent`.
 */
export function BoardCollabProvider({
  doc,
  documentId,
  workspaceId,
  currentUser,
  readOnly = false,
  panel,
  children,
}: {
  doc: Document<YorkieBoardRoot> | undefined;
  documentId: string;
  workspaceId?: string;
  currentUser?: { id: number; username: string; photo?: string } | null;
  readOnly?: boolean;
  /**
   * The comments panel's open flag, when the host keeps it — the editor
   * does, in `useRightPanels`, so comments share the right-hand slot with
   * history and chat. Kept here otherwise (a share-link viewer).
   */
  panel?: readonly [boolean, (open: boolean) => void];
  children: ReactNode;
}) {
  const store = useMemo(() => (doc ? new BoardCommentStore(doc) : null), [doc]);
  useEffect(() => () => store?.dispose(), [store]);

  const toolRef = useRef<RitualTool | null>(null);
  if (toolRef.current === null) toolRef.current = createRitualTool();
  const tool = toolRef.current;

  const members = useWorkspaceMembers(workspaceId);
  const [threads, setThreads] = useState<Thread<BoardAnchor>[]>([]);
  const [liveIds, setLiveIds] = useState<ReadonlySet<string>>(() => new Set());
  const localPanel = useState(false);
  const [panelOpen, setPanelOpen] = panel ?? localPanel;
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingBoardComment | null>(null);
  const focusAnchorRef = useRef<((anchor: BoardAnchor) => void) | null>(null);

  // Re-read on content changes only (the store filters out presence). A
  // signature check skips the React commit when an edit elsewhere on the
  // board left the threads untouched — most edits on a busy board.
  const signatureRef = useRef("");
  const refresh = useCallback(() => {
    if (!store || !doc) {
      setThreads([]);
      return;
    }
    const next = store.listThreadsSync();
    const signature = JSON.stringify(next);
    if (signature !== signatureRef.current) {
      signatureRef.current = signature;
      setThreads(next);
    }
    const ids = topLevelIds(doc);
    setLiveIds((prev) => (sameIds(prev, ids) ? prev : ids));
  }, [store, doc]);

  useEffect(() => {
    if (!store) return;
    refresh();
    return store.subscribe(refresh);
  }, [store, refresh]);

  const user = useMemo<BoardCollabUser | null>(() => {
    if (!currentUser) return null;
    const author: CommentAuthor = {
      userId: String(currentUser.id),
      username: currentUser.username,
    };
    if (currentUser.photo) author.photo = currentUser.photo;
    return { key: `u${currentUser.id}`, name: currentUser.username, author };
  }, [currentUser]);

  const listThread = useCallback(
    (threadId: string) =>
      store?.listThreadsSync().find((t) => t.id === threadId) ?? null,
    [store],
  );

  const addThread = useCallback(
    async (anchor: BoardAnchor, body: string) => {
      if (!store || !user || readOnly) return null;
      const t = await store.addThread(anchor, body, user.author);
      notifyCommentEvent({
        event: "thread",
        documentId,
        actorUserId: user.author.userId,
        thread: t,
        comment: t.comments[t.comments.length - 1],
      });
      refresh();
      return t.id;
    },
    [store, user, readOnly, documentId, refresh],
  );

  const addReply = useCallback(
    async (threadId: string, body: string) => {
      if (!store || !user || readOnly) return;
      const comment = await store.addReply(threadId, body, user.author);
      const thread = listThread(threadId);
      if (thread) {
        notifyCommentEvent({
          event: "reply",
          documentId,
          actorUserId: user.author.userId,
          thread,
          comment,
        });
      }
      refresh();
    },
    [store, user, readOnly, documentId, refresh, listThread],
  );

  const setResolved = useCallback(
    async (threadId: string, resolved: boolean) => {
      if (!store || !user || readOnly) return;
      await store.setThreadResolved(threadId, resolved, user.author);
      // Reopening is not an event anyone is waiting on.
      if (resolved) {
        const thread = listThread(threadId);
        if (thread) {
          notifyCommentEvent({
            event: "resolve",
            documentId,
            actorUserId: user.author.userId,
            thread,
          });
        }
      }
      refresh();
    },
    [store, user, readOnly, documentId, refresh, listThread],
  );

  const editComment = useCallback(
    async (threadId: string, commentId: string, body: string) => {
      if (!store || readOnly) return;
      await store.editComment(threadId, commentId, body);
      refresh();
    },
    [store, readOnly, refresh],
  );

  const deleteComment = useCallback(
    async (threadId: string, commentId: string) => {
      if (!store || readOnly) return;
      await store.deleteComment(threadId, commentId);
      refresh();
    },
    [store, readOnly, refresh],
  );

  const openThread = useCallback((thread: Thread<BoardAnchor>) => {
    setActiveThreadId(thread.id);
    setPanelOpen(true);
    focusAnchorRef.current?.(thread.anchor);
  }, [setPanelOpen]);

  const value: BoardCollabValue = {
    documentId,
    readOnly,
    user,
    members,
    tool,
    threads,
    liveIds,
    panelOpen,
    setPanelOpen,
    activeThreadId,
    setActiveThreadId,
    pending,
    setPending,
    addThread,
    addReply,
    setResolved,
    editComment,
    deleteComment,
    focusAnchorRef,
    openThread,
  };

  return (
    <BoardCollabContext.Provider value={value}>
      {children}
    </BoardCollabContext.Provider>
  );
}
