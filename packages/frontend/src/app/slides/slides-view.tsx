import {
  initializeEditor,
  mountThumbnailPanel,
  mountNotesPanel,
  type SlidesEditor,
  type ThumbnailPanelHandle,
} from "@wafflebase/slides";
import { useEffect, useRef, useState } from "react";
import { useDocument } from "@yorkie-js/react";
import { Loader } from "@/components/loader";
import type { YorkieSlidesRoot } from "@/types/slides-document";
import type { SlidesPresence } from "@/types/users";
import { YorkieSlidesStore, ensureSlidesRoot } from "./yorkie-slides-store";

export type { SlidesEditor } from "@wafflebase/slides";

interface SlidesViewProps {
  /**
   * Document id passed from the route. Currently unused inside the
   * component — Yorkie attach is handled by the surrounding
   * `DocumentProvider` keyed by id — but kept on the prop surface so
   * the parent route can pass it explicitly (matches DocsView).
   */
  documentId?: string;
  /**
   * Reserved for Phase 4b: when true the editor will mount in a
   * non-interactive presenter view. Phase 4a accepts the flag for
   * API parity with `DocsView` but does not act on it yet.
   */
  readOnly?: boolean;
  onEditorReady?: (editor: SlidesEditor | null) => void;
}

const HOST_W = 960;
const HOST_H = 540;

/**
 * SlidesView mounts the vanilla `@wafflebase/slides` editor inside a
 * Yorkie DocumentProvider context. It builds the canvas + overlay +
 * thumbnail + notes DOM hosts into a React-managed container, wires a
 * YorkieSlidesStore to the editor, and broadcasts presence updates on
 * selection / current-slide changes.
 *
 * Mirrors the structure of `docs-view.tsx`: `useDocument` for the
 * Yorkie doc handle, a `didMount` gate to dodge React strict-mode's
 * double mount, and a single mount-time `useEffect` whose cleanup
 * cancels the RAF tick, disposes the thumbnail panel, detaches the
 * editor, unsubscribes presence callbacks, and removes the injected
 * style tag.
 */
export function SlidesView({ onEditorReady }: SlidesViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<SlidesEditor | null>(null);
  const [didMount, setDidMount] = useState(false);
  const { doc, loading, error } = useDocument<YorkieSlidesRoot, SlidesPresence>();

  // Prevent double-initialization in React strict mode / dev HMR.
  useEffect(() => {
    setDidMount(true);
  }, []);

  useEffect(() => {
    if (!didMount || !doc) return;
    const container = containerRef.current;
    if (!container) return;

    ensureSlidesRoot(doc);

    // Build the canvas + overlay DOM into the container. The slides
    // editor is vanilla DOM, so we hand-build the scaffolding here
    // instead of expressing it as JSX — a future refactor could move
    // this into a `useEditorMount` hook.
    container.innerHTML = "";
    const dpr = window.devicePixelRatio || 1;

    const layout = document.createElement("div");
    layout.style.display = "grid";
    layout.style.gridTemplateColumns = "220px 1fr";
    layout.style.gap = "12px";
    layout.style.padding = "12px";
    layout.style.boxSizing = "border-box";
    layout.style.height = "100%";

    const left = document.createElement("div");
    left.style.overflowY = "auto";
    const thumbsHost = document.createElement("div");
    left.appendChild(thumbsHost);
    layout.appendChild(left);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.flexDirection = "column";
    right.style.gap = "12px";

    const canvasWrap = document.createElement("div");
    canvasWrap.style.position = "relative";
    canvasWrap.style.alignSelf = "flex-start";

    const canvas = document.createElement("canvas");
    canvas.width = HOST_W * dpr;
    canvas.height = HOST_H * dpr;
    canvas.style.width = `${HOST_W}px`;
    canvas.style.height = `${HOST_H}px`;
    canvas.style.background = "#fff";
    canvasWrap.appendChild(canvas);

    const overlay = document.createElement("div");
    overlay.style.position = "absolute";
    overlay.style.left = "0";
    overlay.style.top = "0";
    overlay.style.width = `${HOST_W}px`;
    overlay.style.height = `${HOST_H}px`;
    overlay.style.pointerEvents = "none";
    canvasWrap.appendChild(overlay);

    right.appendChild(canvasWrap);

    const notesHost = document.createElement("div");
    right.appendChild(notesHost);

    layout.appendChild(right);
    container.appendChild(layout);

    // Inject pointer-events for handles (overlay-level CSS). The
    // overlay itself uses pointer-events: none so empty-area clicks
    // pass through to the canvas; handle children opt back in.
    const style = document.createElement("style");
    style.textContent = "[data-handle] { pointer-events: auto !important; }";
    document.head.appendChild(style);

    const store = new YorkieSlidesStore(doc);
    const editor = initializeEditor({
      canvas,
      overlay,
      store,
      hostWidth: HOST_W,
      hostHeight: HOST_H,
      dpr,
    });
    editorRef.current = editor;
    onEditorReady?.(editor);

    const thumbHandle: ThumbnailPanelHandle = mountThumbnailPanel(
      thumbsHost,
      store,
      editor,
    );
    mountNotesPanel(notesHost, store, editor);

    // Re-render on remote change. Yorkie's mutation proxy is already
    // updated when this fires; we just need to repaint canvas + thumbs.
    store.onRemoteChange = () => {
      editor.render();
      thumbHandle.refresh();
    };

    // Local presence: broadcast active slide + selection. The
    // username/email/photo fields are filled in by the SlidesDetail
    // wrapper via `initialPresence`; we only patch the slides-specific
    // fields here so we don't clobber the identity payload.
    const broadcast = () => {
      store.updatePresence({
        username: "",
        email: "",
        photo: "",
        activeSlideId: editor.getCurrentSlideId(),
        selectedElementIds: editor.getSelection().slice(),
      });
    };
    const offSelection = editor.onSelectionChange(broadcast);
    const offSlide = editor.onCurrentSlideChange(broadcast);

    // RAF loop so async asset loads (image cache) repaint, and
    // thumbnail count stays in sync with store mutations the panel
    // doesn't observe directly.
    let lastSlideCount = store.read().slides.length;
    let raf = 0;
    const tick = () => {
      editor.render();
      const n = store.read().slides.length;
      if (n !== lastSlideCount) {
        lastSlideCount = n;
        thumbHandle.refresh();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      offSelection();
      offSlide();
      thumbHandle.dispose();
      editor.detach();
      editorRef.current = null;
      onEditorReady?.(null);
      style.remove();
    };
    // onEditorReady is intentionally excluded — re-mounting on every
    // identity change of the parent's setter would tear down the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [didMount, doc]);

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

  return <div ref={containerRef} className="relative flex-1 w-full min-h-0" />;
}

export default SlidesView;
