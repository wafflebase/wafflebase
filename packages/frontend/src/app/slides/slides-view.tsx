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

// Logical slide aspect (1920×1080 = 16:9). The canvas is sized to fit
// the available width of the right column, preserving this aspect.
const SLIDE_ASPECT = 16 / 9;
const MIN_HOST_W = 320;  // floor so very narrow viewports still paint something usable
const MAX_HOST_W = 1600; // ceiling so on ultra-wide displays we don't paint a 4K bitmap

function computeFitSize(availWidth: number, availHeight: number): {
  width: number;
  height: number;
} {
  // Width-binding fit (typical case — the column is shorter than wide).
  const widthFit = {
    width: availWidth,
    height: availWidth / SLIDE_ASPECT,
  };
  if (widthFit.height <= availHeight) return widthFit;
  // Height-binding fallback for tall narrow viewports.
  return {
    width: availHeight * SLIDE_ASPECT,
    height: availHeight,
  };
}

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
 *
 * CJK fonts: the slides text renderer routes inline `fontFamily`
 * values through the docs font registry (see
 * `packages/slides/src/view/canvas/fonts.ts`), which appends
 * `'Noto Sans KR'` to Korean font name fallback chains. No font is
 * fetched here — Canvas relies on the browser's installed fonts plus
 * its own last-resort glyph fallback, matching how the docs editor
 * paints CJK in its live editor today. PDF export (Phase 5b) will
 * preload Noto KR via `document.fonts.load` the same way docs'
 * PDF exporter does.
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
    // minmax(0, 1fr) constrains the row height to the parent's height,
    // letting the left column's overflowY actually scroll instead of
    // expanding the grid to fit all thumbnails. min-height: 0 on the
    // grid items themselves is the standard CSS-grid scrollable-child
    // workaround.
    layout.style.gridTemplateRows = "minmax(0, 1fr)";
    layout.style.gap = "12px";
    layout.style.padding = "12px";
    layout.style.boxSizing = "border-box";
    layout.style.height = "100%";

    const left = document.createElement("div");
    left.style.overflowY = "auto";
    left.style.minHeight = "0";
    const thumbsHost = document.createElement("div");
    left.appendChild(thumbsHost);
    layout.appendChild(left);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.flexDirection = "column";
    right.style.gap = "12px";
    right.style.minWidth = "0";  // allow the column to shrink + width-fit
    right.style.minHeight = "0";

    // Canvas + overlay live inside this wrapper. Sized later by the
    // ResizeObserver below — mounting at MIN_HOST_W avoids a flash of
    // an unsized canvas during the first layout pass.
    const canvasWrap = document.createElement("div");
    canvasWrap.style.position = "relative";
    canvasWrap.style.alignSelf = "flex-start";

    const initial = computeFitSize(MIN_HOST_W, MIN_HOST_W / SLIDE_ASPECT);
    let hostW = initial.width;
    let hostH = initial.height;

    const canvas = document.createElement("canvas");
    canvas.width = hostW * dpr;
    canvas.height = hostH * dpr;
    canvas.style.width = `${hostW}px`;
    canvas.style.height = `${hostH}px`;
    canvas.style.background = "#fff";
    canvasWrap.appendChild(canvas);

    const overlay = document.createElement("div");
    overlay.style.position = "absolute";
    overlay.style.left = "0";
    overlay.style.top = "0";
    overlay.style.width = `${hostW}px`;
    overlay.style.height = `${hostH}px`;
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
      hostWidth: hostW,
      hostHeight: hostH,
      dpr,
    });
    editorRef.current = editor;
    onEditorReady?.(editor);

    // Auto-fit the canvas to the right column. Re-fits on ResizeObserver
    // ticks (window resize, sidebar collapse, devtools open). Caps at
    // MAX_HOST_W so we don't paint a 4K bitmap on ultra-wide displays
    // — the slide is logically 1920×1080 anyway.
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const rightRect = entry.contentRect;
      // Reserve room for the notes panel below the canvas + the column
      // gap (12px). The notes panel is content-sized so we can't query
      // a fixed value; subtract a generous reservation that errs on the
      // side of leaving the canvas a bit small rather than overflowing.
      const reservedForNotes = notesHost.getBoundingClientRect().height + 12;
      const availW = Math.max(MIN_HOST_W, Math.min(MAX_HOST_W, rightRect.width));
      const availH = Math.max(MIN_HOST_W / SLIDE_ASPECT, rightRect.height - reservedForNotes);
      const fit = computeFitSize(availW, availH);
      const nextW = Math.round(fit.width);
      const nextH = Math.round(fit.height);
      if (nextW === hostW && nextH === hostH) return;
      hostW = nextW;
      hostH = nextH;
      canvas.width = hostW * dpr;
      canvas.height = hostH * dpr;
      canvas.style.width = `${hostW}px`;
      canvas.style.height = `${hostH}px`;
      overlay.style.width = `${hostW}px`;
      overlay.style.height = `${hostH}px`;
      editor.setHostSize(hostW, hostH);
    });
    resizeObserver.observe(right);

    const thumbHandle: ThumbnailPanelHandle = mountThumbnailPanel(
      thumbsHost,
      store,
      editor,
    );
    mountNotesPanel(notesHost, store, editor);

    // Re-render on ANY store change — local batch commits OR remote
    // changes pushed in by another peer.
    //
    // markDirty before render is required because the renderer's
    // dirty flag is reset after each successful paint, so a remote
    // change wouldn't otherwise trigger a repaint (the editor doesn't
    // know the underlying data shifted under it). markDirty is also
    // safe to call after local edits — the next render is a no-op if
    // the renderer already painted the same frame.
    //
    // thumbHandle.refresh() is the only way A's own thumbnail picks
    // up a drag/resize commit on the current slide, since the
    // thumbnail panel only listens to selection / current-slide
    // changes, neither of which fires for an in-place frame update.
    const offChange = store.onChange(() => {
      editor.markDirty();
      editor.render();
      thumbHandle.refresh();
    });

    // Local presence: broadcast active slide + selection. Yorkie's
    // Presence.set merges (does not replace), so we pass ONLY the
    // slides-specific fields. The username/email/photo were seeded by
    // SlidesDetail via `initialPresence` and stay intact across these
    // partial updates.
    const broadcast = () => {
      store.updatePresence({
        activeSlideId: editor.getCurrentSlideId(),
        selectedElementIds: editor.getSelection().slice(),
      });
    };
    const offSelection = editor.onSelectionChange(broadcast);
    const offSlide = editor.onCurrentSlideChange(broadcast);

    // RAF loop so async asset loads (image cache) repaint, and
    // thumbnail count stays in sync with store mutations the panel
    // doesn't observe directly. Use the O(1) `getSlideCount()`
    // accessor for the count comparison — `store.read()` here would
    // JSON-clone the whole presentation 60 times per second, scaling
    // linearly with deck size and stressing the GC at idle.
    let lastSlideCount = store.getSlideCount();
    let raf = 0;
    const tick = () => {
      editor.render();
      const n = store.getSlideCount();
      if (n !== lastSlideCount) {
        lastSlideCount = n;
        thumbHandle.refresh();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(raf);
      offSelection();
      offSlide();
      offChange();
      thumbHandle.dispose();
      editor.detach();
      store.dispose();
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
