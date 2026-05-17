import { useDocument } from "@yorkie-js/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  SlideRenderer,
  initializeEditor,
  type SlidesDocument,
  type SlidesEditor,
} from "@wafflebase/slides";
import { Loader } from "@/components/loader";
import { usePointerSwipe } from "@/hooks/use-pointer-swipe";
import type { YorkieSlidesRoot } from "@/types/slides-document";
import type { SlidesPresence } from "@/types/users";
import { SlidesPresentationMode } from "./slides-presentation-mode";
import {
  YorkieSlidesStore,
  ensureSlidesRoot,
} from "./yorkie-slides-store";

const SLIDE_ASPECT = SLIDE_WIDTH / SLIDE_HEIGHT;

/**
 * Picks the largest 16:9 box that fits inside the available area.
 * Duplicated from `view/present/presenter.ts` and `slides-view.tsx`
 * on purpose — the slides package can't depend on the frontend, and
 * the math is small (see slides-mobile-view design doc).
 */
function computeFitSize(
  availWidth: number,
  availHeight: number,
): { width: number; height: number } {
  const widthFit = { width: availWidth, height: availWidth / SLIDE_ASPECT };
  if (widthFit.height <= availHeight) return widthFit;
  return { width: availHeight * SLIDE_ASPECT, height: availHeight };
}

interface MobileSlidesViewProps {
  documentId: string;
  /** Page title from the Documents API. Falls back to Yorkie meta title. */
  title?: string;
  /** Override the back action; defaults to `navigate(-1)`. */
  onBack?: () => void;
  /**
   * `'view'` mounts a read-only `SlideRenderer` (Phase A behavior).
   * `'edit'` mounts the full `SlidesEditor` with touch-friendly
   * handle tolerance and iOS callout suppression (Phase B). Default
   * `'edit'`; the caller (`slides-detail.tsx`) flips to `'view'`
   * for shared-link viewers without edit permission.
   */
  mode?: "view" | "edit";
}

/** Touch hit slack passed to the editor in `edit` mode. 22px expands
 * each 8px visual handle into ~44px hit area — Apple HIG min. */
const TOUCH_HANDLE_TOLERANCE = 22;

/**
 * Mobile shell for the slides deck. Mounted by `slides-detail.tsx`'s
 * `SlidesLayout` when `useIsMobile()` is true, replacing the full
 * desktop chrome (sidebar / site header / toolbar / SlidesView).
 *
 * `mode='view'` keeps Phase A's read-only `SlideRenderer` path with
 * left/right swipe slide nav. `mode='edit'` (default) mounts the
 * full `SlidesEditor` against canvas + overlay, with touch hit
 * tolerance forwarded so fingertips can grab handles. Editing
 * mutations flow through the existing `SlidesStore`, so Yorkie
 * sync and undo/redo are inherited from desktop.
 */
export function MobileSlidesView({
  title,
  onBack,
  mode = "edit",
}: MobileSlidesViewProps) {
  const navigate = useNavigate();
  const { doc, loading, error } = useDocument<
    YorkieSlidesRoot,
    SlidesPresence
  >();

  // Build the store once per `doc`. We keep the store around so the
  // Present button can hand it to `<SlidesPresentationMode>` without
  // re-wrapping on every render. Disposed in cleanup.
  const [store, setStore] = useState<YorkieSlidesStore | null>(null);
  useEffect(() => {
    if (!doc) return;
    ensureSlidesRoot(doc);
    const s = new YorkieSlidesStore(doc);
    setStore(s);
    return () => {
      s.dispose();
      setStore(null);
    };
  }, [doc]);

  // Snapshot of the parts of the deck the mobile shell renders.
  // Refreshed whenever the store fires `onChange` (covers local writes
  // — though we don't issue any here — and remote peer edits).
  const [snapshot, setSnapshot] = useState<{
    title: string;
    slideIds: string[];
  }>({ title: title ?? "", slideIds: [] });

  useEffect(() => {
    if (!store) return;
    const refresh = () => {
      const r = store.read();
      setSnapshot({
        title: title ?? r.meta?.title ?? "Untitled",
        slideIds: r.slides.map((s) => s.id),
      });
    };
    refresh();
    return store.onChange(refresh);
  }, [store, title]);

  const [currentSlideId, setCurrentSlideId] = useState<string>("");
  useEffect(() => {
    if (snapshot.slideIds.length === 0) {
      setCurrentSlideId("");
      return;
    }
    setCurrentSlideId((id) =>
      snapshot.slideIds.includes(id) ? id : snapshot.slideIds[0],
    );
  }, [snapshot.slideIds]);

  const currentIndex = useMemo(
    () => snapshot.slideIds.indexOf(currentSlideId),
    [snapshot.slideIds, currentSlideId],
  );

  const nextSlide = useCallback(() => {
    if (currentIndex < 0 || currentIndex >= snapshot.slideIds.length - 1) return;
    setCurrentSlideId(snapshot.slideIds[currentIndex + 1]);
  }, [currentIndex, snapshot.slideIds]);

  const prevSlide = useCallback(() => {
    if (currentIndex <= 0) return;
    setCurrentSlideId(snapshot.slideIds[currentIndex - 1]);
  }, [currentIndex, snapshot.slideIds]);

  const canvasHostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<SlidesEditor | null>(null);

  // Swipe nav is only enabled in `view` mode. In `edit` mode the
  // editor owns horizontal pointer (drag-to-move), and any tap that
  // crosses the swipe threshold would compete with the drag.
  const swipeOptions = useMemo(
    () =>
      mode === "view"
        ? { onSwipeLeft: nextSlide, onSwipeRight: prevSlide }
        : { onSwipeLeft: () => {}, onSwipeRight: () => {} },
    [mode, nextSlide, prevSlide],
  );
  usePointerSwipe(canvasHostRef, swipeOptions);

  // View mode — read-only SlideRenderer (Phase A). A single
  // SlideRenderer is bound to the current host size; on resize it's
  // rebuilt (cheap constructor) inside a RAF-coalesced ResizeObserver
  // callback. Repaint triggers on slide id changes or store.onChange.
  useEffect(() => {
    if (mode !== "view") return;
    const canvas = canvasRef.current;
    const host = canvasHostRef.current;
    if (!canvas || !host || !store) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;

    let renderer: SlideRenderer | null = null;
    let lastDoc: SlidesDocument = store.read();

    function paint() {
      if (!renderer) return;
      const slide = lastDoc.slides.find((s) => s.id === currentSlideId);
      if (!slide) return;
      renderer.markDirty();
      renderer.render(slide, lastDoc);
    }

    function applyFit() {
      const rect = host!.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const fit = computeFitSize(rect.width, rect.height);
      const cssW = Math.round(fit.width);
      const cssH = Math.round(fit.height);
      canvas!.width = Math.round(cssW * dpr);
      canvas!.height = Math.round(cssH * dpr);
      canvas!.style.width = `${cssW}px`;
      canvas!.style.height = `${cssH}px`;
      renderer = new SlideRenderer(ctx!, {
        hostWidth: cssW,
        hostHeight: cssH,
        dpr,
      });
      paint();
    }

    let rafScheduled = false;
    const ro = new ResizeObserver(() => {
      if (rafScheduled) return;
      rafScheduled = true;
      requestAnimationFrame(() => {
        rafScheduled = false;
        applyFit();
      });
    });
    ro.observe(host);
    applyFit();

    const unsubscribe = store.onChange(() => {
      lastDoc = store.read();
      paint();
    });

    return () => {
      ro.disconnect();
      unsubscribe();
      renderer = null;
    };
  }, [mode, store, currentSlideId]);

  // Edit mode — mount the full SlidesEditor. Reuses the desktop
  // editor's programmatic surface (`enterTextEditing`, `setSelection`,
  // `setCurrentSlide`, `store.*`). The Pointer Events migration in
  // the slides package makes touch drag/resize/rotate work; the
  // `touchHandleTolerance` option expands the 8px visual handles to
  // ~44px touch targets without growing the handles themselves.
  useEffect(() => {
    if (mode !== "edit") return;
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const host = canvasHostRef.current;
    if (!canvas || !overlay || !host || !store) return;
    const dpr = window.devicePixelRatio || 1;

    // Handles render with [data-handle] inside an overlay whose
    // own pointer-events is `none` (so empty-area taps fall through
    // to the canvas). The handles opt back in via this style.
    const styleTag = document.createElement("style");
    styleTag.textContent =
      "[data-handle] { pointer-events: auto !important; }";
    document.head.appendChild(styleTag);

    let hostW = 0;
    let hostH = 0;

    function applyFit(): boolean {
      const rect = host!.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const fit = computeFitSize(rect.width, rect.height);
      hostW = Math.round(fit.width);
      hostH = Math.round(fit.height);
      canvas!.width = hostW * dpr;
      canvas!.height = hostH * dpr;
      canvas!.style.width = `${hostW}px`;
      canvas!.style.height = `${hostH}px`;
      overlay!.style.width = `${hostW}px`;
      overlay!.style.height = `${hostH}px`;
      return true;
    }

    if (!applyFit()) {
      hostW = 1;
      hostH = 1;
    }

    const editor = initializeEditor({
      canvas,
      overlay,
      store,
      hostWidth: hostW,
      hostHeight: hostH,
      dpr,
      touchHandleTolerance: TOUCH_HANDLE_TOLERANCE,
    });
    editorRef.current = editor;

    if (currentSlideId) editor.setCurrentSlide(currentSlideId);
    editor.render();

    let rafScheduled = false;
    const ro = new ResizeObserver(() => {
      if (rafScheduled) return;
      rafScheduled = true;
      requestAnimationFrame(() => {
        rafScheduled = false;
        const rect = host!.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const fit = computeFitSize(rect.width, rect.height);
        const nextW = Math.round(fit.width);
        const nextH = Math.round(fit.height);
        if (nextW === hostW && nextH === hostH) return;
        hostW = nextW;
        hostH = nextH;
        canvas!.width = hostW * dpr;
        canvas!.height = hostH * dpr;
        canvas!.style.width = `${hostW}px`;
        canvas!.style.height = `${hostH}px`;
        overlay!.style.width = `${hostW}px`;
        overlay!.style.height = `${hostH}px`;
        editor.setHostSize(hostW, hostH);
      });
    });
    ro.observe(host);

    // Mirror editor-driven slide changes back into React state so the
    // footer indicator updates if anything other than the arrows
    // changes the current slide.
    const offSlideChange = editor.onCurrentSlideChange(() => {
      const id = editor.getCurrentSlideId();
      if (id && id !== currentSlideId) setCurrentSlideId(id);
    });

    return () => {
      offSlideChange();
      ro.disconnect();
      editorRef.current = null;
      styleTag.remove();
    };
    // currentSlideId is intentionally NOT a dep: it would tear down
    // the editor on every footer-arrow tap. The cross-direction
    // sync from React → editor lives in its own effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, store]);

  // Push React-side slide changes (footer arrows) into the editor so
  // the canvas re-paints without an editor teardown.
  useEffect(() => {
    if (mode !== "edit") return;
    const editor = editorRef.current;
    if (!editor || !currentSlideId) return;
    if (editor.getCurrentSlideId() !== currentSlideId) {
      editor.setCurrentSlide(currentSlideId);
    }
  }, [mode, currentSlideId]);

  const handleBack = useCallback(() => {
    if (onBack) onBack();
    else navigate(-1);
  }, [onBack, navigate]);

  const [presentingFrom, setPresentingFrom] = useState<"current" | null>(null);
  const handlePresent = useCallback(() => {
    if (!store || store.read().slides.length === 0) return;
    setPresentingFrom("current");
  }, [store]);

  const presentationStartSlideId =
    presentingFrom && currentSlideId ? currentSlideId : undefined;

  if (loading) return <Loader />;
  if (error) {
    return (
      <div role="alert" style={{ padding: 16 }}>
        Failed to load deck.
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        maxHeight: "100vh",
        overflow: "hidden",
        background: "#fff",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          height: 44,
          padding: "0 8px",
          gap: 8,
          borderBottom: "1px solid #e5e7eb",
          flexShrink: 0,
          background: "#fff",
        }}
      >
        <button
          type="button"
          aria-label="Back to deck list"
          onClick={handleBack}
          style={{
            width: 36,
            height: 36,
            fontSize: 22,
            background: "transparent",
            border: 0,
            cursor: "pointer",
          }}
        >
          ‹
        </button>
        <h1
          style={{
            flex: 1,
            fontSize: 16,
            fontWeight: 500,
            margin: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {snapshot.title || "Untitled"}
        </h1>
        <button
          type="button"
          aria-label="Start presentation"
          onClick={handlePresent}
          disabled={snapshot.slideIds.length === 0}
          style={{
            width: 36,
            height: 36,
            fontSize: 16,
            background: "transparent",
            border: 0,
            cursor: snapshot.slideIds.length === 0 ? "not-allowed" : "pointer",
            opacity: snapshot.slideIds.length === 0 ? 0.4 : 1,
          }}
        >
          ▶
        </button>
      </header>

      <div
        ref={canvasHostRef}
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#000",
          // edit: canvas owns horizontal pointer (drag-to-move), so
          // disable all browser touch gestures (pinch, pan, double-tap
          // zoom). view: allow vertical pan for short pages, but the
          // canvas-host fills the screen so this rarely matters.
          touchAction: mode === "edit" ? "none" : "pan-y",
          // iOS long-press callout (text/image preview) is NOT a
          // contextmenu event — onContextMenu can't block it. The
          // CSS combo below is what stops it from appearing on top
          // of the editor's own selection / context menu.
          WebkitTouchCallout: mode === "edit" ? "none" : undefined,
          WebkitUserSelect: mode === "edit" ? "none" : undefined,
          userSelect: mode === "edit" ? "none" : undefined,
        }}
        onContextMenu={
          mode === "edit" ? (e) => e.preventDefault() : undefined
        }
      >
        {mode === "edit" ? (
          // Wrapper holds canvas + overlay aligned by absolute
          // positioning. Editor mount writes both their CSS sizes.
          <div style={{ position: "relative" }}>
            <canvas
              ref={canvasRef}
              aria-label={`Slide ${Math.max(currentIndex + 1, 0)} of ${snapshot.slideIds.length}`}
              style={{ display: "block" }}
            />
            <div
              ref={overlayRef}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                // pointer-events:none so empty-area taps fall
                // through to canvas; handle children opt back in
                // via the injected `[data-handle]` style.
                pointerEvents: "none",
              }}
            />
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            aria-label={`Slide ${Math.max(currentIndex + 1, 0)} of ${snapshot.slideIds.length}`}
          />
        )}
      </div>

      <footer
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          height: 28,
          fontSize: 13,
          flexShrink: 0,
          borderTop: "1px solid #e5e7eb",
          background: "#fff",
        }}
      >
        <button
          type="button"
          aria-label="Previous slide"
          onClick={prevSlide}
          disabled={currentIndex <= 0}
          style={{
            minWidth: 32,
            background: "transparent",
            border: 0,
            cursor: currentIndex <= 0 ? "not-allowed" : "pointer",
            opacity: currentIndex <= 0 ? 0.4 : 1,
          }}
        >
          ‹
        </button>
        <span>
          {Math.max(currentIndex + 1, 0)} / {snapshot.slideIds.length}
        </span>
        <button
          type="button"
          aria-label="Next slide"
          onClick={nextSlide}
          disabled={currentIndex >= snapshot.slideIds.length - 1}
          style={{
            minWidth: 32,
            background: "transparent",
            border: 0,
            cursor:
              currentIndex >= snapshot.slideIds.length - 1
                ? "not-allowed"
                : "pointer",
            opacity:
              currentIndex >= snapshot.slideIds.length - 1 ? 0.4 : 1,
          }}
        >
          ›
        </button>
      </footer>

      {presentingFrom && store && presentationStartSlideId && (
        <SlidesPresentationMode
          store={store}
          startSlideId={presentationStartSlideId}
          onExit={() => setPresentingFrom(null)}
        />
      )}
    </div>
  );
}
