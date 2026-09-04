import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Document } from "@yorkie-js/react";
import type { EditorAPI } from "@wafflebase/docs";

import type {
  CommentAuthor,
  DocsRangeAnchor,
  Thread,
} from "@/types/comments";
import type { YorkieDocsRoot } from "@/types/docs-document";

import {
  docPositionToTreePath,
  extractAnchorContext,
  resolveDocsAnchor,
} from "./docs-anchor";
import { notifyCommentEvent } from "@/components/comments/notify";
import { computeCommentMarkers } from "./decorations";
import {
  StaleCommentAnchorError,
  YorkieCommentStore,
  copyDocsThread,
} from "./yorkie-comment-store";

export interface DocsCommentsState {
  open: ReadonlyArray<Thread<DocsRangeAnchor>>;
  orphaned: ReadonlyArray<Thread<DocsRangeAnchor>>;
  resolved: ReadonlyArray<Thread<DocsRangeAnchor>>;
}

export interface ActivePopover {
  thread: Thread<DocsRangeAnchor>;
  anchorRect: { x: number; y: number };
}

export interface UseDocsCommentsOpts {
  doc: Document<YorkieDocsRoot> | null;
  editor: EditorAPI | null;
  container: HTMLDivElement | null;
  currentUser: CommentAuthor | null;
  readOnly: boolean;
  /**
   * Enables notification reports for comment activity. Omitted (or empty)
   * simply means no reports — an anonymous share-link session has no
   * document id to attribute them to and no inbox to receive them.
   */
  documentId?: string;
  /**
   * Optional controlled state for the side panel. When `panelOpen` and
   * `onPanelOpenChange` are both provided, the hook delegates the
   * open/close state to the caller — used so a parent component can
   * mount a topbar toggle next to its own state. When omitted, the
   * hook owns the state internally and `Cmd+Alt+Shift+M` toggles it.
   */
  panelOpen?: boolean;
  onPanelOpenChange?: (open: boolean) => void;
}

export interface UseDocsCommentsHandle {
  store: YorkieCommentStore | null;
  state: DocsCommentsState;
  active: ActivePopover | null;
  /**
   * Whether this session can create a comment at all: `beginCompose`'s
   * session-level preconditions (editable, an editor is mounted, and a
   * signed-in author to attribute the thread to), lifted out so a menu
   * can hide an unusable "Insert comment" row without having to know
   * *why* it is unusable.
   *
   * The one precondition left out is the text selection, because that is
   * per-right-click rather than per-session — each menu reads it from the
   * editor when it opens.
   *
   * `currentUser` is null for an anonymous visitor, and an **editor**-role
   * share link opened anonymously is editable (`readOnly === false`), so
   * this is not implied by `readOnly`.
   */
  canComment: boolean;
  panelOpen: boolean;
  togglePanel: () => void;
  closePanel: () => void;
  dismissPopover: () => void;
  /**
   * Open the composer-ready state for a new comment at the current
   * editor selection. Returns false when there is no selection.
   */
  beginCompose: () => boolean;
  composeOpen: boolean;
  closeCompose: () => void;
  submitNewComment: (body: string) => Promise<void>;
  reply: (threadId: string, body: string) => Promise<void>;
  editComment: (
    threadId: string,
    commentId: string,
    body: string,
  ) => Promise<void>;
  deleteComment: (threadId: string, commentId: string) => Promise<void>;
  toggleResolved: (thread: Thread<DocsRangeAnchor>) => Promise<void>;
  /** Scroll the editor so the thread's anchor is in view (live threads only). */
  jumpToThread: (thread: Thread<DocsRangeAnchor>) => void;
}

/**
 * Orchestrates everything comments-related for the docs editor:
 * subscribes to the comment store, pushes markers to the editor,
 * handles marker clicks, and exposes the side-panel / popover state.
 */
export function useDocsComments(opts: UseDocsCommentsOpts): UseDocsCommentsHandle {
  const { doc, editor, container, currentUser, readOnly, documentId } = opts;
  const storeRef = useRef<YorkieCommentStore | null>(null);
  const [storeReady, setStoreReady] = useState(0);
  const [state, setState] = useState<DocsCommentsState>({
    open: [],
    orphaned: [],
    resolved: [],
  });
  const [active, setActive] = useState<ActivePopover | null>(null);
  const [internalPanelOpen, setInternalPanelOpen] = useState(false);
  const controlledPanelOpen = opts.panelOpen;
  const onPanelOpenChange = opts.onPanelOpenChange;
  const panelOpen =
    controlledPanelOpen !== undefined ? controlledPanelOpen : internalPanelOpen;
  const setPanelOpen = useCallback(
    (next: boolean) => {
      if (onPanelOpenChange) onPanelOpenChange(next);
      else setInternalPanelOpen(next);
    },
    [onPanelOpenChange],
  );
  const [composeOpen, setComposeOpen] = useState(false);
  const pendingRangeRef = useRef<{
    startPath: number[];
    endPath: number[];
    blockId: string;
    quotedText: string;
  } | null>(null);

  // Build / dispose the YorkieCommentStore alongside the doc.
  useEffect(() => {
    if (!doc) {
      storeRef.current = null;
      return;
    }
    const store = new YorkieCommentStore(doc);
    storeRef.current = store;
    setStoreReady((n) => n + 1);
    return () => {
      store.dispose();
      storeRef.current = null;
    };
  }, [doc]);

  // Recompute snapshot + push marker ranges to the editor on every store
  // change (which fires on local + remote document mutations).
  useEffect(() => {
    const store = storeRef.current;
    if (!store || !doc || !editor) return;

    const recompute = async () => {
      const tree = doc.getRoot().content;
      const docModel = editor.getDoc().document;
      const all = await store.listThreads();
      const open: Thread<DocsRangeAnchor>[] = [];
      const orphaned: Thread<DocsRangeAnchor>[] = [];
      const resolved: Thread<DocsRangeAnchor>[] = [];
      for (const t of all) {
        if (t.resolved) {
          resolved.push(t);
          continue;
        }
        const r = resolveDocsAnchor(tree, t.anchor);
        if (r.kind === 'live') open.push(t);
        else orphaned.push(t);
      }
      setState({ open, orphaned, resolved });

      const markers = computeCommentMarkers(open, docModel, tree);
      editor.setCommentMarkers(markers);
    };

    void recompute();
    const unsub = store.subscribe(() => {
      void recompute();
    });
    return unsub;
  }, [storeReady, doc, editor]);

  // Click on a marker → open popover. Click anywhere else → dismiss.
  //
  // Clicks inside the comment popover or side panel bubble up to this
  // native listener faster than React's synthetic event delegation can
  // run the popover's onClick. Without the early bail-out, a click on
  // a button inside the popover hit-tests at the button's coordinates,
  // finds no marker, calls setActive(null), and unmounts the popover
  // before its own button handler ever fires — Resolve / Edit / Delete
  // appeared to do nothing but close the popover.
  useEffect(() => {
    if (!container || !editor) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target && target.closest('[data-comments-overlay]')) {
        return;
      }
      const markerId = editor.getCommentMarkerAt(e.clientX, e.clientY);
      if (!markerId) {
        setActive(null);
        return;
      }
      const thread =
        state.open.find((t) => t.id === markerId) ??
        state.orphaned.find((t) => t.id === markerId);
      if (!thread) return;
      setActive({
        thread,
        anchorRect: { x: e.clientX, y: e.clientY },
      });
    };
    container.addEventListener('click', onClick);
    return () => container.removeEventListener('click', onClick);
  }, [container, editor, state]);

  // Refresh the active popover's thread snapshot whenever state changes
  // (e.g. after a reply), so the popover always shows the latest
  // comments without forcing the user to reopen it. If the thread moves
  // to `resolved` (its marker disappears from the canvas) or to
  // `orphaned` (no marker either), dismiss the popover — leaving it
  // open over an anchor the user can no longer see is confusing.
  useEffect(() => {
    if (!active) return;
    const fresh = state.open.find((t) => t.id === active.thread.id);
    if (!fresh) {
      setActive(null);
    } else if (fresh !== active.thread) {
      setActive({ ...active, thread: fresh });
    }
  }, [state, active]);

  const togglePanel = useCallback(
    () => setPanelOpen(!panelOpen),
    [panelOpen, setPanelOpen],
  );
  const closePanel = useCallback(() => setPanelOpen(false), [setPanelOpen]);
  const dismissPopover = useCallback(() => setActive(null), []);
  const closeCompose = useCallback(() => {
    setComposeOpen(false);
    pendingRangeRef.current = null;
  }, []);

  // Single source of truth for "could a comment be created here", shared
  // with the context menus so a row can never be offered for an action
  // `beginCompose` refuses on its first line.
  const canComment = !readOnly && !!editor && !!currentUser;

  const beginCompose = useCallback((): boolean => {
    // `!editor` is redundant with `canComment` at runtime; it is repeated
    // so TypeScript narrows `editor` below.
    if (!canComment || !editor) return false;
    const sel = editor.getActiveSelection();
    if (!sel) return false;
    const docModel = editor.getDoc().document;
    const startPath = docPositionToTreePath(docModel, sel.anchor);
    const endPath = docPositionToTreePath(docModel, sel.focus);
    if (!startPath || !endPath) return false;
    const { blockId, quotedText } = extractAnchorContext(docModel, sel);
    // Normalize forward order.
    const [s, e] =
      pathCompare(startPath, endPath) <= 0
        ? [startPath, endPath]
        : [endPath, startPath];
    pendingRangeRef.current = { startPath: s, endPath: e, blockId, quotedText };
    setComposeOpen(true);
    return true;
  }, [editor, canComment]);

  const submitNewComment = useCallback(
    async (body: string) => {
      const store = storeRef.current;
      const pending = pendingRangeRef.current;
      if (!store || !pending || !currentUser) return;
      // Close the composer only on success. If addThread throws, leave
      // it open so the user can retry; CommentComposer already logs the
      // error and keeps the body intact (it clears only on resolve).
      try {
        const thread = await store.addThread(pending, body, currentUser);
        notifyCommentEvent({
          event: 'thread',
          documentId,
          actorUserId: currentUser.userId,
          thread,
          comment: thread.comments[thread.comments.length - 1],
        });
      } catch (err) {
        // A collaborator deleted the anchored text between compose and
        // submit. The range can't be re-anchored, so retrying is futile —
        // dismiss the composer with a toast instead of leaving it stuck.
        if (err instanceof StaleCommentAnchorError) {
          toast.error("That text was changed by a collaborator. Try selecting the text again.");
          pendingRangeRef.current = null;
          setComposeOpen(false);
          return;
        }
        throw err;
      }
      pendingRangeRef.current = null;
      setComposeOpen(false);
    },
    [currentUser, documentId],
  );

  const reply = useCallback(
    async (threadId: string, body: string) => {
      const store = storeRef.current;
      if (!store || !currentUser) return;
      const comment = await store.addReply(threadId, body, currentUser);
      const thread = (await store.listThreads()).find((t) => t.id === threadId);
      if (thread) {
        notifyCommentEvent({
          event: 'reply',
          documentId,
          actorUserId: currentUser.userId,
          thread,
          comment,
        });
      }
    },
    [currentUser, documentId],
  );

  const editCommentFn = useCallback(
    async (threadId: string, commentId: string, body: string) => {
      const store = storeRef.current;
      if (!store) return;
      await store.editComment(threadId, commentId, body);
    },
    [],
  );

  const deleteCommentFn = useCallback(
    async (threadId: string, commentId: string) => {
      const store = storeRef.current;
      if (!store) return;
      await store.deleteComment(threadId, commentId);
    },
    [],
  );

  const toggleResolved = useCallback(
    async (thread: Thread<DocsRangeAnchor>) => {
      const store = storeRef.current;
      if (!store || !currentUser) return;
      const resolving = !thread.resolved;
      await store.setThreadResolved(thread.id, resolving, currentUser);
      // Only resolving is worth a notification; reopening is not an event
      // anyone is waiting on.
      if (resolving) {
        // Re-read rather than reusing the `thread` prop: that is a React
        // snapshot, and a reply Yorkie applied since the last render would be
        // missing from it — dropping that participant from the recipients.
        // The sheets and pdf paths already do this.
        const current = (await store.listThreads()).find(
          (t) => t.id === thread.id,
        );
        notifyCommentEvent({
          event: 'resolve',
          documentId,
          actorUserId: currentUser.userId,
          thread: current ?? thread,
        });
      }
    },
    [currentUser, documentId],
  );

  const jumpToThread = useCallback(
    (thread: Thread<DocsRangeAnchor>) => {
      if (!doc || !editor) return;
      const tree = doc.getRoot().content;
      const resolved = resolveDocsAnchor(tree, thread.anchor);
      if (resolved.kind !== 'live') return;
      const docModel = editor.getDoc().document;
      const startBlockIdx = resolved.startPath[0];
      const startBlock = docModel.blocks[startBlockIdx];
      if (!startBlock) return;
      editor.scrollToPosition({ blockId: startBlock.id, offset: 0 });
    },
    [doc, editor],
  );

  return {
    store: storeRef.current,
    state,
    active,
    canComment,
    panelOpen,
    togglePanel,
    closePanel,
    dismissPopover,
    beginCompose,
    composeOpen,
    closeCompose,
    submitNewComment,
    reply,
    editComment: editCommentFn,
    deleteComment: deleteCommentFn,
    toggleResolved,
    jumpToThread,
  };
}

function pathCompare(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

// Re-export for callers that want to fully detach Yorkie proxies.
export { copyDocsThread };
