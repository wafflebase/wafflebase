import {
  initialize,
  type EditorAPI,
  type ThemeMode,
  type PeerCursor,
} from "@wafflebase/docs";
import { getPeerCursorColor } from "@wafflebase/sheets";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useDocument, Tree } from "@yorkie-js/react";
import { useQuery } from "@tanstack/react-query";
import { Loader } from "@/components/loader";
import { useTheme } from "@/components/theme-provider";
import type { YorkieDocsRoot } from "@/types/docs-document";
import type { CommentAuthor } from "@/types/comments";
import { fetchMeOptional } from "@/api/auth";
import { Button } from "@/components/ui/button";
import { CommentComposer } from "@/components/comments/components/CommentComposer";
import { CommentSidePanel } from "@/components/comments/components/CommentSidePanel";
import { OrphanedCard } from "@/components/comments/components/OrphanedCard";
import { YorkieDocStore } from "./yorkie-doc-store";
import { useGoogleFontsLink } from "@/components/text-formatting/font-catalog";
import { DocsLinkPopover } from "./docs-link-popover";
import { DocsFindBar } from "./docs-find-bar";
import { DocsShortcutsHelp } from "./docs-shortcuts-help";
import { DocsTableContextMenu } from "./docs-table-context-menu";
import { DocsCommentContextMenu } from "./comments/DocsCommentContextMenu";
import { DocsCommentPopover } from "./comments/DocsCommentPopover";
import { useDocsComments } from "./comments/docs-comments-controller";
import { clearPendingImport, peekPendingImport } from "./pending-imports";
import { insertImageFromFile } from "./image-insert";

export type { EditorAPI } from "@wafflebase/docs";

export interface JumpHandle {
  jumpToPeer: (clientID: string) => void;
}

/**
 * Ensure the Yorkie document has a Tree CRDT for content.
 *
 * New docs receive the Tree via `client.attach({ initialRoot })`
 * (see `initialDocsRoot()`), and yorkie-js-sdk PR #1238 clears the
 * undo stack right after — so the setup is not undoable.
 *
 * This helper is a fallback for legacy docs whose Tree was never
 * persisted. After creating the Tree we call `clearHistory()` so
 * the setup is similarly absent from the undo stack; otherwise a
 * long enough Cmd+Z sequence could unwind the Tree creation and
 * destroy the initial block, crashing the editor.
 */
function ensureTree(doc: ReturnType<typeof useDocument<YorkieDocsRoot>>["doc"]): boolean {
  if (!doc) return false;
  const root = doc.getRoot();

  if (root.content && typeof root.content.getRootTreeNode === "function") {
    return true;
  }

  // Create Tree CRDT with a single empty paragraph block.
  doc.update((r) => {
    r.content = new Tree({
      type: "doc",
      children: [
        {
          type: "block",
          attributes: {
            id: `block-${Date.now()}-0`,
            type: "paragraph",
            alignment: "left",
            lineHeight: "1.5",
            marginTop: "0",
            marginBottom: "8",
            textIndent: "0",
            marginLeft: "0",
          },
          children: [
            {
              type: "inline",
              children: [],
            },
          ],
        },
      ],
    });
  });
  doc.clearHistory();

  return true;
}

const LABEL_VISIBLE_DURATION = 4000;
const CURSOR_UPDATE_THROTTLE = 100;
const HOVER_RADIUS = 10;

interface DocsViewProps {
  onEditorReady?: (editor: EditorAPI | null) => void;
  /**
   * Optional handle exposing imperative peer-jump.
   * The DocsView calls this with a handle on mount and `null` on unmount.
   */
  onJumpHandleReady?: (handle: JumpHandle | null) => void;
  readOnly?: boolean;
  /**
   * Controlled state for the comments side panel. Provide this from a
   * parent (e.g. DocsLayout) that owns a topbar toggle button. When
   * omitted, the panel state is internal and only the keyboard
   * shortcut can toggle it.
   */
  commentsPanelOpen?: boolean;
  onCommentsPanelOpenChange?: (open: boolean) => void;
  /**
   * Optional document id used to consume any pending DOCX import that
   * was staged before navigation (see `pending-imports.ts`). When set,
   * the imported `Document` is applied via `store.setDocument()` once
   * the editor finishes mounting.
   */
  documentId?: string;
}

/**
 * DocsView mounts the Canvas-based document editor inside a Yorkie
 * DocumentProvider context.  It creates a YorkieDocStore, calls
 * `initialize(container, store, theme)`, and wires remote changes to re-render.
 * It also subscribes to presence changes for peer cursors with label visibility
 * and hover detection.
 */
export function DocsView({
  onEditorReady,
  onJumpHandleReady,
  readOnly,
  commentsPanelOpen,
  onCommentsPanelOpenChange,
  documentId,
}: DocsViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // State-mirrored handle on the same DOM node, so effects that depend
  // on the container (the comments controller's click handler) re-bind
  // when the element actually mounts instead of relying on a follow-up
  // re-render triggered by mountedEditor.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const setContainerNode = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
    setContainerEl(el);
  }, []);
  const editorRef = useRef<EditorAPI | null>(null);
  const storeRef = useRef<YorkieDocStore | null>(null);
  const [mountedEditor, setMountedEditor] = useState<EditorAPI | null>(null);
  const [didMount, setDidMount] = useState(false);
  const [findBarOpen, setFindBarOpen] = useState(false);
  const [findBarShowReplace, setFindBarShowReplace] = useState(false);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const [linkInputRequest, setLinkInputRequest] = useState<{
    initialUrl: string;
    position: { x: number; y: number; height: number };
  } | null>(null);
  const { doc, loading, error } = useDocument<YorkieDocsRoot>();
  const { resolvedTheme } = useTheme();

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMeOptional,
    staleTime: 5 * 60 * 1000,
  });
  const currentUser = useMemo<CommentAuthor | null>(() => {
    if (!me) return null;
    return {
      userId: String(me.id),
      username: me.username,
      photo: me.photo || undefined,
    };
  }, [me]);

  const comments = useDocsComments({
    doc: doc ?? null,
    editor: mountedEditor,
    container: containerEl,
    currentUser,
    readOnly: Boolean(readOnly),
    panelOpen: commentsPanelOpen,
    onPanelOpenChange: onCommentsPanelOpenChange,
  });

  const peerLabelTimers = useRef<Map<string, number>>(new Map());
  const prevPeerCursorPos = useRef<Map<string, string>>(new Map());
  const visiblePeerLabels = useRef<Set<string>>(new Set());
  const hoveredPeerClientID = useRef<string | null>(null);
  const lastCursorUpdate = useRef<number>(0);
  const cursorTrailingTimer = useRef<number | undefined>(undefined);
  const themeRef = useRef(resolvedTheme);

  // Keep theme ref in sync so callbacks always see the latest value.
  themeRef.current = resolvedTheme;

  // Prevent double-initialization in React strict mode / dev HMR.
  useEffect(() => {
    setDidMount(true);
  }, []);

  // Inject the Google Fonts `<link>` for read-only / shared-URL viewers
  // that never mount the toolbar. Idempotent across surfaces.
  useGoogleFontsLink();

  const buildPeerCursors = useCallback((): PeerCursor[] => {
    const store = storeRef.current;
    if (!store) return [];

    const theme = (themeRef.current === "dark" ? "dark" : "light") as "light" | "dark";
    const presences = store.getPresences();
    return presences
      .filter((p) => p.presence.activeCursorPos)
      .map((p) => {
        const username = p.presence.username || "Anonymous";
        const sel = p.presence.activeSelection;
        return {
          clientID: p.clientID,
          position: p.presence.activeCursorPos!,
          color: getPeerCursorColor(theme, p.clientID),
          username,
          labelVisible:
            visiblePeerLabels.current.has(p.clientID) ||
            hoveredPeerClientID.current === p.clientID,
          selection: sel ? { anchor: sel.anchor, focus: sel.focus, tableCellRange: sel.tableCellRange } : undefined,
        };
      });
  }, []);

  const jumpToPeer = useCallback((clientID: string) => {
    const store = storeRef.current;
    const editor = editorRef.current;
    if (!store || !editor) return;

    const peer = store.getPresences().find((p) => p.clientID === clientID);
    const pos = peer?.presence.activeCursorPos;
    if (!pos) return;

    editor.scrollToPosition(pos);

    // Reset and restart the label visibility timer so the user can
    // confirm whose position they landed at.
    const existing = peerLabelTimers.current.get(clientID);
    if (existing) clearTimeout(existing);
    visiblePeerLabels.current.add(clientID);
    const timer = window.setTimeout(() => {
      visiblePeerLabels.current.delete(clientID);
      peerLabelTimers.current.delete(clientID);
      editorRef.current?.setPeerCursors(buildPeerCursors());
    }, LABEL_VISIBLE_DURATION);
    peerLabelTimers.current.set(clientID, timer);

    editor.setPeerCursors(buildPeerCursors());
  }, [buildPeerCursors]);

  useEffect(() => {
    if (!onJumpHandleReady) return;
    onJumpHandleReady({ jumpToPeer });
    return () => {
      onJumpHandleReady(null);
    };
  }, [onJumpHandleReady, jumpToPeer]);

  const handlePresenceChange = useCallback(() => {
    const store = storeRef.current;
    const editor = editorRef.current;
    if (!store || !editor) return;

    const presences = store.getPresences();
    const currentPeerIds = new Set<string>();

    for (const { clientID, presence } of presences) {
      currentPeerIds.add(clientID);
      if (!presence.activeCursorPos) continue;

      const posKey = `${presence.activeCursorPos.blockId}:${presence.activeCursorPos.offset}`;
      const prevKey = prevPeerCursorPos.current.get(clientID);

      if (posKey !== prevKey) {
        prevPeerCursorPos.current.set(clientID, posKey);

        const existingTimer = peerLabelTimers.current.get(clientID);
        if (existingTimer) clearTimeout(existingTimer);

        visiblePeerLabels.current.add(clientID);

        const timer = window.setTimeout(() => {
          visiblePeerLabels.current.delete(clientID);
          peerLabelTimers.current.delete(clientID);
          editorRef.current?.setPeerCursors(buildPeerCursors());
        }, LABEL_VISIBLE_DURATION);

        peerLabelTimers.current.set(clientID, timer);
      }
    }

    for (const clientID of [...prevPeerCursorPos.current.keys()]) {
      if (!currentPeerIds.has(clientID)) {
        prevPeerCursorPos.current.delete(clientID);
        visiblePeerLabels.current.delete(clientID);
        const timer = peerLabelTimers.current.get(clientID);
        if (timer) clearTimeout(timer);
        peerLabelTimers.current.delete(clientID);
      }
    }

    editor.setPeerCursors(buildPeerCursors());
  }, [buildPeerCursors]);

  useEffect(() => {
    const container = containerRef.current;
    if (!didMount || !container || !doc) return;
    if (!ensureTree(doc)) return;

    const store = new YorkieDocStore(doc);
    storeRef.current = store;
    const theme = (resolvedTheme === "dark" ? "dark" : "light") as ThemeMode;
    const editor: EditorAPI = initialize(container, store, theme, readOnly);
    editorRef.current = editor;
    setMountedEditor(editor);
    onEditorReady?.(editor);

    // If a DOCX import was staged for this document before navigation,
    // apply it now that the store and editor are ready. The editor's
    // cursor currently points to the initial empty-doc block id which
    // no longer exists after setDocument; resetAfterDocumentReplace
    // resets the cursor, clears the selection, and invalidates layout.
    //
    // Peek (rather than take) the pending entry so that a failing apply
    // leaves the import in the registry. It will be retried on the next
    // mount (e.g. after an HMR reload) instead of being silently lost.
    if (documentId) {
      const pending = peekPendingImport(documentId);
      if (pending) {
        try {
          store.setDocument(pending);
          // setDocument succeeded; the document is now persisted. Clear pending
          // immediately so a subsequent reset failure doesn't cause re-apply.
          clearPendingImport(documentId);
          editor.resetAfterDocumentReplace();
        } catch (err) {
          console.error("Failed to apply pending DOCX import", err);
          // If setDocument itself threw, pending is still in peek state and
          // will be retried on next mount. If reset threw, it was already
          // cleared above — just the editor state is stale, which the user
          // can recover from with a reload.
        }
      }
    }

    if (import.meta.env.DEV) {
      (window as Record<string, unknown>).__docsEditor = editor;
    }

    // Re-render the editor whenever a remote peer modifies the document.
    // refresh() updates the Doc's cached document from the store, then
    // render() repaints the canvas with the latest content.
    store.onRemoteChange = () => {
      const resolvedLocalCursor = store.resolveAnchoredLocalCursor();
      editor.getDoc().refresh();
      editor.restoreLocalCursor(
        resolvedLocalCursor.cursor,
        resolvedLocalCursor.selection,
      );
      if (resolvedLocalCursor.compositionStart && editor.isComposing()) {
        editor.updateCompositionStartPosition(resolvedLocalCursor.compositionStart);
      }
      store.publishResolvedLocalCursor({
        cursor: resolvedLocalCursor.cursor,
        selection: resolvedLocalCursor.selection,
      });
      editor.validateCursorPosition();
      editor.render();
    };

    editor.onCompositionStart((startPos) => {
      store.setCompositionStart(startPos);
    });
    editor.onCompositionEnd(() => {
      store.setCompositionStart(null);
    });

    const unsubPresence = doc.subscribe("others", () => {
      handlePresenceChange();
    });

    editor.onCursorMove((pos, sel) => {
      const now = Date.now();
      if (cursorTrailingTimer.current) clearTimeout(cursorTrailingTimer.current);
      if (now - lastCursorUpdate.current >= CURSOR_UPDATE_THROTTLE) {
        lastCursorUpdate.current = now;
        store.updateCursorPos(pos, sel);
      } else {
        const remaining = Math.max(
          0,
          CURSOR_UPDATE_THROTTLE - (now - lastCursorUpdate.current),
        );
        cursorTrailingTimer.current = window.setTimeout(() => {
          lastCursorUpdate.current = Date.now();
          store.updateCursorPos(pos, sel);
          cursorTrailingTimer.current = undefined;
        }, remaining);
      }
    });

    editor.onFindRequest(() => {
      setFindBarOpen(true);
      setFindBarShowReplace(false);
    });
    editor.onFindReplaceRequest(() => {
      setFindBarOpen(true);
      setFindBarShowReplace(true);
    });

    editor.onLinkRequest(() => {
      const pos = editor.getCursorScreenRect();
      if (!pos) return;
      const existingHref = editor.getLinkAtCursor() ?? "";
      setLinkInputRequest({ initialUrl: existingHref, position: pos });
    });

    // Drag-and-drop + clipboard paste of image files. The docs
    // package only knows how to intercept the raw File; upload + URL
    // resolution + insert all live in the frontend because they
    // depend on auth cookies and the `/images` endpoint.
    editor.onImageFileDrop((file, pos) => {
      void insertImageFromFile(editor, file, pos);
    });

    const handleMouseMove = (e: MouseEvent) => {
      const ed = editorRef.current;
      if (!ed) return;

      const containerRect = container.getBoundingClientRect();
      const mouseX = e.clientX - containerRect.left + container.scrollLeft;
      const mouseY = e.clientY - containerRect.top + container.scrollTop;

      const peerPixels = ed.getPeerCursorPixels();
      let newHoveredID: string | null = null;

      for (const peer of peerPixels) {
        if (
          Math.abs(mouseX - peer.x) < HOVER_RADIUS &&
          mouseY >= peer.y - HOVER_RADIUS &&
          mouseY <= peer.y + peer.height + HOVER_RADIUS
        ) {
          newHoveredID = peer.clientID;
          break;
        }
      }

      if (newHoveredID !== hoveredPeerClientID.current) {
        hoveredPeerClientID.current = newHoveredID;
        ed.setPeerCursors(buildPeerCursors());
      }
    };

    const handleMouseLeave = () => {
      const ed = editorRef.current;
      if (!ed || hoveredPeerClientID.current == null) return;
      hoveredPeerClientID.current = null;
      ed.setPeerCursors(buildPeerCursors());
    };

    container.addEventListener("mousemove", handleMouseMove);
    container.addEventListener("mouseleave", handleMouseLeave);

    // Capture refs in local variables so the cleanup closure is stable.
    const labelTimers = peerLabelTimers.current;
    const prevPos = prevPeerCursorPos.current;
    const visibleLabels = visiblePeerLabels.current;

    return () => {
      for (const timer of labelTimers.values()) {
        clearTimeout(timer);
      }
      labelTimers.clear();
      prevPos.clear();
      visibleLabels.clear();
      hoveredPeerClientID.current = null;
      if (cursorTrailingTimer.current) {
        clearTimeout(cursorTrailingTimer.current);
        cursorTrailingTimer.current = undefined;
      }

      container.removeEventListener("mousemove", handleMouseMove);
      container.removeEventListener("mouseleave", handleMouseLeave);
      unsubPresence();
      editor.dispose();
      editorRef.current = null;
      setMountedEditor(null);
      storeRef.current = null;
      onEditorReady?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [didMount, doc]);

  // Update the editor theme when the user toggles light/dark mode.
  useEffect(() => {
    if (editorRef.current) {
      const mode = (resolvedTheme === "dark" ? "dark" : "light") as ThemeMode;
      editorRef.current.setTheme(mode);
      editorRef.current.setPeerCursors(buildPeerCursors());
    }
  }, [resolvedTheme, buildPeerCursors]);

  // Keyboard shortcuts for comments.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || !e.altKey) return;
      if (e.key === "M" || e.key === "m") {
        if (e.shiftKey) {
          e.preventDefault();
          comments.togglePanel();
        } else {
          if (comments.beginCompose()) e.preventDefault();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [comments]);

  // Cmd/Ctrl+/ opens the shortcuts help modal. The docs text-editor
  // doesn't bind "/" so the event bubbles to window unhindered. Open-only
  // (Esc closes via Radix) matches the Slides binding for cross-app
  // consistency; `e.repeat` is filtered so auto-repeat on a held chord
  // doesn't flicker the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        setShortcutsHelpOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (loading) {
    return <Loader />;
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-red-500">{error.message}</div>
      </div>
    );
  }

  return (
    <div ref={setContainerNode} className="relative flex-1 w-full min-h-0">
      <DocsShortcutsHelp
        open={shortcutsHelpOpen}
        onOpenChange={setShortcutsHelpOpen}
      />
      <DocsLinkPopover
        editor={mountedEditor}
        containerRef={containerRef}
        editRequest={linkInputRequest}
        onEditRequestHandled={() => setLinkInputRequest(null)}
      />
      {findBarOpen && (
        <DocsFindBar
          editor={mountedEditor}
          showReplace={findBarShowReplace}
          onClose={() => setFindBarOpen(false)}
          containerRef={containerRef}
        />
      )}
      <DocsTableContextMenu
        editor={mountedEditor}
        containerRef={containerRef}
        readOnly={readOnly}
        onInsertComment={() => {
          comments.beginCompose();
        }}
      />
      <DocsCommentContextMenu
        editor={mountedEditor}
        containerRef={containerRef}
        readOnly={readOnly}
        onInsertComment={() => {
          comments.beginCompose();
        }}
      />
      {comments.active && (
        <DocsCommentPopover
          thread={comments.active.thread}
          anchorRect={comments.active.anchorRect}
          currentUser={currentUser ?? undefined}
          readOnly={readOnly}
          onReply={(body) => comments.reply(comments.active!.thread.id, body)}
          onResolveToggle={() => comments.toggleResolved(comments.active!.thread)}
          onEdit={(commentId, body) =>
            comments.editComment(comments.active!.thread.id, commentId, body)
          }
          onDelete={(commentId) =>
            comments.deleteComment(comments.active!.thread.id, commentId)
          }
          onDismiss={comments.dismissPopover}
        />
      )}
      {comments.composeOpen && (
        <div
          role="dialog"
          aria-label="Insert comment"
          data-comments-overlay=""
          className="fixed left-1/2 top-1/3 z-50 w-80 -translate-x-1/2 rounded-md border bg-popover p-3 text-popover-foreground shadow-lg"
        >
          <CommentComposer
            submitLabel="Comment"
            autoFocus
            onSubmit={comments.submitNewComment}
            onCancel={comments.closeCompose}
            disabled={!currentUser}
          />
        </div>
      )}
      {comments.panelOpen && (
        <div data-comments-overlay="" className="absolute right-0 top-0 z-40 h-full">
          <CommentSidePanel
            threads={[...comments.state.open, ...comments.state.resolved]}
            orphanedThreads={comments.state.orphaned}
            onJumpTo={(t) => {
              comments.jumpToThread(t);
            }}
            onClose={comments.closePanel}
            renderAnchorLabel={(t) =>
              t.anchor.quotedText ? (
                <span className="italic">
                  &ldquo;{t.anchor.quotedText.slice(0, 40)}
                  {t.anchor.quotedText.length > 40 ? "…" : ""}&rdquo;
                </span>
              ) : null
            }
            renderOrphan={(t) => (
              <OrphanedCard
                quotedText={t.anchor.quotedText}
                root={t.comments[0]}
                commentCount={t.comments.length}
                trailing={
                  !readOnly && currentUser ? (
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px]"
                        onClick={() => {
                          void comments.toggleResolved(t);
                        }}
                      >
                        {t.resolved ? "Reopen" : "Resolve"}
                      </Button>
                    </div>
                  ) : null
                }
              />
            )}
          />
        </div>
      )}
    </div>
  );
}

export default DocsView;
