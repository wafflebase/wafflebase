import {
  initialize,
  type EditorAPI,
  type ThemeMode,
  type PeerCursor,
} from "@wafflebase/docs";
import { getPeerCursorColor } from "@wafflebase/sheets";
import { useEffect, useRef, useState, useCallback } from "react";
import { useDocument, Tree } from "@yorkie-js/react";
import { Loader } from "@/components/loader";
import { useTheme } from "@/components/theme-provider";
import type { YorkieDocsRoot } from "@/types/docs-document";
import { YorkieDocStore } from "./yorkie-doc-store";
import { DocsLinkPopover } from "./docs-link-popover";
import { DocsFindBar } from "./docs-find-bar";

export type { EditorAPI } from "@wafflebase/docs";

/**
 * Ensure the Yorkie document has a Tree CRDT for content.
 * Tree must be created via `new Tree()` inside doc.update();
 * it cannot be passed as a plain object through initialRoot.
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

  return true;
}

const LABEL_VISIBLE_DURATION = 4000;
const CURSOR_UPDATE_THROTTLE = 100;
const HOVER_RADIUS = 10;

interface DocsViewProps {
  onEditorReady?: (editor: EditorAPI | null) => void;
  readOnly?: boolean;
}

/**
 * DocsView mounts the Canvas-based document editor inside a Yorkie
 * DocumentProvider context.  It creates a YorkieDocStore, calls
 * `initialize(container, store, theme)`, and wires remote changes to re-render.
 * It also subscribes to presence changes for peer cursors with label visibility
 * and hover detection.
 */
export function DocsView({ onEditorReady, readOnly }: DocsViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorAPI | null>(null);
  const storeRef = useRef<YorkieDocStore | null>(null);
  const [mountedEditor, setMountedEditor] = useState<EditorAPI | null>(null);
  const [didMount, setDidMount] = useState(false);
  const [findBarOpen, setFindBarOpen] = useState(false);
  const [findBarShowReplace, setFindBarShowReplace] = useState(false);
  const [linkInputRequest, setLinkInputRequest] = useState<{
    initialUrl: string;
    position: { x: number; y: number; height: number };
  } | null>(null);
  const { doc, loading, error } = useDocument<YorkieDocsRoot>();
  const { resolvedTheme } = useTheme();

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

  const buildPeerCursors = useCallback((): PeerCursor[] => {
    const store = storeRef.current;
    if (!store) return [];

    const theme = (themeRef.current === "dark" ? "dark" : "light") as "light" | "dark";
    const presences = store.getPresences();
    return presences
      .filter((p) => p.presence.activeCursorPos)
      .map((p) => {
        let username = "Anonymous";
        if (p.presence.username) {
          try {
            username = decodeURIComponent(p.presence.username);
          } catch {
            username = p.presence.username;
          }
        }
        const sel = p.presence.activeSelection;
        return {
          clientID: p.clientID,
          position: p.presence.activeCursorPos!,
          color: getPeerCursorColor(theme, p.clientID),
          username,
          labelVisible:
            visiblePeerLabels.current.has(p.clientID) ||
            hoveredPeerClientID.current === p.clientID,
          selection: sel ? { anchor: sel.anchor, focus: sel.focus } : undefined,
        };
      });
  }, []);

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

    // Re-render the editor whenever a remote peer modifies the document.
    // refresh() updates the Doc's cached document from the store, then
    // render() repaints the canvas with the latest content.
    store.onRemoteChange = () => {
      editor.getDoc().refresh();
      editor.render();
    };

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
    <div ref={containerRef} className="relative flex-1 w-full min-h-0">
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
    </div>
  );
}

export default DocsView;
