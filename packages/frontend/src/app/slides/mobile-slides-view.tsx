import { useDocument } from "@yorkie-js/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { IconPlus } from "@tabler/icons-react";
import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  SlideRenderer,
  initializeEditor,
  renderThumbnail,
  type SlidesDocument,
  type SlidesEditor,
} from "@wafflebase/slides";
import { Loader } from "@/components/loader";
import { useTheme } from "@/components/theme-provider";
import { usePointerSwipe } from "@/hooks/use-pointer-swipe";
import type { YorkieSlidesRoot } from "@/types/slides-document";
import type { SlidesPresence } from "@/types/users";
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

/** Order-sensitive shallow equality for slide-id arrays. */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

interface MobileSlidesViewProps {
  /**
   * `'view'` mounts a read-only `SlideRenderer` (Phase A behavior).
   * `'edit'` mounts the full `SlidesEditor` with touch-friendly
   * handle tolerance and iOS callout suppression (Phase B). Default
   * `'edit'`; the caller (`slides-detail.tsx`) flips to `'view'`
   * for shared-link viewers without edit permission.
   */
  mode?: "view" | "edit";
  /**
   * Lift the Yorkie store up to the parent so the SiteHeader's
   * Present button and the SlidesToolbar's undo/redo can wire into
   * it (matches `SlidesView`'s `onStoreReady` on desktop).
   */
  onStoreReady?: (store: YorkieSlidesStore | null) => void;
  /**
   * Lift the SlidesEditor up to the parent. Only fires in `mode='edit'`
   * — view mode mounts a `SlideRenderer` directly, not an editor.
   */
  onEditorReady?: (editor: SlidesEditor | null) => void;
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
  mode = "edit",
  onStoreReady,
  onEditorReady,
}: MobileSlidesViewProps) {
  const { doc, loading, error } = useDocument<
    YorkieSlidesRoot,
    SlidesPresence
  >();

  // Read the resolved (light|dark) theme through a ref so the store-mount
  // effect can seed a brand-new deck with the matching theme without
  // re-running when the user later toggles dark mode. The `didMount`
  // gate below pushes the seed read out by one render — without it,
  // child-before-parent effect ordering would let this effect fire
  // before `ThemeProvider`'s effect flips `resolvedTheme` from the
  // matchMedia-only initial value to the localStorage-corrected one,
  // which would silently seed a light deck for a user whose explicit
  // dark preference disagrees with their OS setting.
  const { resolvedTheme } = useTheme();
  const resolvedThemeRef = useRef(resolvedTheme);
  resolvedThemeRef.current = resolvedTheme;
  const [didMount, setDidMount] = useState(false);
  useEffect(() => {
    setDidMount(true);
  }, []);

  // Stash the lifted-state callbacks behind refs so the effects below
  // don't re-run whenever the parent renders with a fresh closure for
  // either callback. The parent today passes `setStore`/`setEditor`
  // from useState (referentially stable), but defending the contract
  // here keeps a future inline `(e) => ...` caller from accidentally
  // detaching the editor on every parent render.
  const onStoreReadyRef = useRef(onStoreReady);
  const onEditorReadyRef = useRef(onEditorReady);
  useEffect(() => {
    onStoreReadyRef.current = onStoreReady;
  }, [onStoreReady]);
  useEffect(() => {
    onEditorReadyRef.current = onEditorReady;
  }, [onEditorReady]);

  // Build the store once per `doc`. The parent owns the Present button
  // (in SiteHeader) and the toolbar's undo/redo, so we expose the
  // store via `onStoreReady` as soon as it's built and clear it on
  // cleanup. Disposed in cleanup either way.
  const [store, setStore] = useState<YorkieSlidesStore | null>(null);
  useEffect(() => {
    if (!didMount || !doc) return;
    ensureSlidesRoot(doc, {
      initialThemePreference: resolvedThemeRef.current,
    });
    const s = new YorkieSlidesStore(doc);
    setStore(s);
    onStoreReadyRef.current?.(s);
    return () => {
      s.dispose();
      setStore(null);
      onStoreReadyRef.current?.(null);
    };
  }, [didMount, doc]);

  // Snapshot of the slide list the mobile shell renders. Refreshed
  // whenever the store fires `onChange` so the footer indicator and
  // navigation arrows track remote peer edits.
  const [snapshot, setSnapshot] = useState<{ slideIds: string[] }>({
    slideIds: [],
  });

  useEffect(() => {
    if (!store) return;
    const refresh = () => {
      const nextIds = store.read().slides.map((s) => s.id);
      setSnapshot((prev) =>
        sameIds(prev.slideIds, nextIds) ? prev : { slideIds: nextIds },
      );
    };
    refresh();
    return store.onChange(refresh);
  }, [store]);

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

  // Append a blank slide and jump to it. Mirrors `SlideGroup.onAddBlankSlide`
  // on desktop; surfaced from the thumbnail strip on mobile so the
  // toolbar can drop the redundant `+` button.
  const addBlankSlide = useCallback(() => {
    if (!store) return;
    let newId = "";
    store.batch(() => {
      newId = store.addSlide("blank");
    });
    if (newId) setCurrentSlideId(newId);
  }, [store]);

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

    // TODO: when `SharedSlidesLayout` grows a phone-width branch and
    // mounts `MobileSlidesView` for share links, accept and forward a
    // `readOnly` prop here (the slides editor already supports it via
    // `SlidesEditorOptions.readOnly`). Today the share-link route
    // always uses desktop `SlidesView`, so this mount is owner-only
    // and never read-only.
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
    onEditorReadyRef.current?.(editor);

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
    // Functional setState avoids a stale-closure compare: the outer
    // effect intentionally omits `currentSlideId` from its dep list
    // (so footer-arrow taps don't tear down the editor), which would
    // otherwise freeze `currentSlideId` at mount time inside this
    // callback. The prev-state reducer always sees the latest value.
    const offSlideChange = editor.onCurrentSlideChange(() => {
      const id = editor.getCurrentSlideId();
      if (!id) return;
      setCurrentSlideId((prev) => (prev === id ? prev : id));
    });

    return () => {
      offSlideChange();
      ro.disconnect();
      // detach() drops the editor's document-level pointer/key
      // listeners, tears down the text-box editor if mounted, and
      // cancels any in-flight RAF. Without it, every mode='edit'
      // mount cycle leaks listeners — matches the desktop teardown
      // in slides-view.tsx:479.
      editor.detach();
      editorRef.current = null;
      onEditorReadyRef.current?.(null);
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

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader />
      </div>
    );
  }
  if (error) {
    return (
      <div role="alert" className="p-4 text-sm text-destructive">
        Failed to load deck.
      </div>
    );
  }

  return (
    <>
      <div
        ref={canvasHostRef}
        className="flex flex-1 items-center justify-center bg-black"
        style={{
          minHeight: 0,
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

      <ThumbnailStrip
        store={store}
        slideIds={snapshot.slideIds}
        currentSlideId={currentSlideId}
        onSelectSlide={setCurrentSlideId}
        onAddSlide={mode === "edit" ? addBlankSlide : undefined}
      />
    </>
  );
}

/** Mobile horizontal scroll strip showing every slide as a mini canvas.
 * Replaces the desktop side panel for navigation on phones — tap to
 * jump, current slide outlined, repaint debounced via `store.onChange`. */
const THUMB_W = 64;
const THUMB_H = Math.round(THUMB_W / SLIDE_ASPECT);
// Debounce paint to coalesce the per-keystroke onChange events that
// fire while the user is editing a text box — without this, every
// character would force renderThumbnail() on every slide.
const THUMB_REPAINT_MS = 120;

interface ThumbnailStripProps {
  store: YorkieSlidesStore | null;
  slideIds: string[];
  currentSlideId: string;
  onSelectSlide: (id: string) => void;
  onAddSlide?: () => void;
}

function ThumbnailStrip({
  store,
  slideIds,
  currentSlideId,
  onSelectSlide,
  onAddSlide,
}: ThumbnailStripProps) {
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Single subscription painting every thumbnail on each store change.
  // ref callbacks attach by the time the debounce timer fires, so newly
  // added slides paint on their first commit without a separate path.
  useEffect(() => {
    if (!store) return;
    const dpr = window.devicePixelRatio || 1;

    const paint = () => {
      const doc = store.read();
      for (const slide of doc.slides) {
        const canvas = canvasRefs.current.get(slide.id);
        if (!canvas) continue;
        canvas.width = THUMB_W * dpr;
        canvas.height = THUMB_H * dpr;
        canvas.style.width = `${THUMB_W}px`;
        canvas.style.height = `${THUMB_H}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        renderThumbnail(ctx, slide, doc, {
          hostWidth: THUMB_W,
          hostHeight: THUMB_H,
          dpr,
        });
      }
    };

    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedulePaint = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        paint();
      }, THUMB_REPAINT_MS);
    };

    // Paint once on next frame so the first render's ref callbacks
    // have attached the canvases.
    const raf = requestAnimationFrame(paint);
    const off = store.onChange(schedulePaint);

    return () => {
      if (timer) clearTimeout(timer);
      cancelAnimationFrame(raf);
      off();
    };
    // `slideIds` is intentionally NOT a dep — `paint` reads
    // `store.read()` so it always sees the latest slide list. If we
    // included `slideIds` (a fresh array per store.onChange), the
    // cleanup would clear the debounce timer on every change and
    // force an immediate repaint, defeating the 120 ms coalescing.
  }, [store]);

  // Auto-scroll the active thumbnail into view when the current slide
  // changes from anywhere (footer tap, swipe, remote peer, editor).
  useEffect(() => {
    const el = itemRefs.current.get(currentSlideId);
    if (!el) return;
    el.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [currentSlideId]);

  return (
    <div
      className="flex shrink-0 items-center gap-2 overflow-x-auto border-t bg-background px-2 py-2"
      style={{ scrollbarWidth: "thin" }}
    >
      {slideIds.map((id, idx) => {
        const isActive = id === currentSlideId;
        return (
          <button
            key={id}
            ref={(el) => {
              if (el) itemRefs.current.set(id, el);
              else itemRefs.current.delete(id);
            }}
            type="button"
            onClick={() => onSelectSlide(id)}
            aria-label={`Slide ${idx + 1}`}
            aria-current={isActive ? "true" : undefined}
            className={`flex shrink-0 flex-col items-center gap-1 rounded-sm border-2 p-0.5 ${
              isActive ? "border-primary" : "border-transparent"
            }`}
          >
            <canvas
              ref={(el) => {
                if (el) canvasRefs.current.set(id, el);
                else canvasRefs.current.delete(id);
              }}
              className="block bg-white"
              style={{ width: THUMB_W, height: THUMB_H }}
            />
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {idx + 1}
            </span>
          </button>
        );
      })}
      {onAddSlide && (
        <button
          type="button"
          onClick={onAddSlide}
          disabled={!store}
          aria-label="Add slide"
          className="flex shrink-0 flex-col items-center gap-1 rounded-sm border-2 border-transparent p-0.5 disabled:opacity-50"
        >
          <div
            className="flex items-center justify-center rounded-sm border border-dashed text-muted-foreground"
            style={{ width: THUMB_W, height: THUMB_H }}
          >
            <IconPlus size={20} />
          </div>
          <span className="text-[10px] tabular-nums text-muted-foreground">
            +
          </span>
        </button>
      )}
    </div>
  );
}
