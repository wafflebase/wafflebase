import {
  initializeEditor,
  type Frame,
  type PeerView,
  type Slide,
  type SlidesDocument,
  type SlidesEditor,
} from "@wafflebase/slides";
import {
  DEFAULT_VIEWPORT,
  SYNTHETIC_SLIDE_ID,
  screenToWorld,
  type Viewport,
} from "@wafflebase/board";
import { getPeerCursorColor } from "@wafflebase/sheets";
import { useEffect, useRef, useState } from "react";
import { useDocument } from "@yorkie-js/react";
import { toast } from "sonner";
import { isAuthExpiredError } from "@/api/auth";
import { Loader } from "@/components/loader";
import { useTheme } from "@/components/theme-provider";
import type { BoardPresence, YorkieBoardRoot } from "@/types/board-document";
import { YorkieBoardStore } from "./yorkie-board-store";
import { applyWheelToViewport } from "./board-wheel";
import { isEditableTarget } from "./is-editable-target";
import { BoardToolbar } from "./board-toolbar";
import { dropStickyAtViewportCenter } from "./sticky";
import { setupSlidesImagePaths } from "../slides/slides-image-input";
import { insertImageOnSlide } from "../slides/insert-image";
import { makeBoardImageUpload } from "./board-image";
import { createBoardMinimap, type BoardMinimap } from "./board-minimap";
import { centerViewportOnWorld } from "./minimap-geometry";
import { createFitToContentOnce, type FitLatch } from "./fit-to-content";
import { FIT_ZOOM } from "../slides/zoom-controller";
import { applyZoomValue, createBoardZoomController } from "./board-zoom";

interface BoardViewProps {
  /**
   * Document id passed from the route. Not read directly inside the
   * mount effect (Yorkie attach is handled by the surrounding
   * `DocumentProvider` keyed by id, mirroring `SlidesView`) — kept on
   * the prop surface for route parity and stamped onto the host `div`
   * so manual smoke / e2e tooling can target this mount by document.
   */
  documentId: string;
  /**
   * Forwarded to `initializeEditor({ readOnly })`. When true, the
   * reused slides editor still paints (including remote peer edits)
   * but skips every pointer/keyboard binding, so a viewer-role
   * share-link visitor can look at and pan/zoom the board without
   * being able to mutate it. Omitted (undefined → editable) on the
   * owner route (`board-detail.tsx`); `SharedBoardLayout` passes
   * `role === 'viewer'`.
   */
  readOnly?: boolean;
  /**
   * Owning workspace id (from the document metadata). Needed to build
   * the image-upload function (`POST /api/v1/workspaces/:id/images`).
   * Undefined while the document query is loading — the Image button
   * stays disabled until it resolves.
   */
  workspaceId?: string;
}

/**
 * Map raw board presences into the editor's presentation-agnostic
 * `PeerView[]`. Mirrors `mapPresenceToPeerView` in
 * `app/slides/peer-view.ts`, simplified for the board's flatter
 * presence shape:
 *
 * - A board has exactly one plane ({@link SYNTHETIC_SLIDE_ID}), so
 *   unlike slides there is no per-peer `activeSlideId` to read — every
 *   peer with a presence is "on" the board, so it is hardcoded here.
 * - `activeFrames` / `draggingGuide` / `selectedTableCells` have no
 *   board equivalent yet (no live-drag broadcast, no guides-read-path,
 *   no tables) — omitted rather than faked.
 */
function mapBoardPeers(
  peers: readonly { clientID: string; presence: BoardPresence }[],
  theme: "light" | "dark",
): PeerView[] {
  const views: PeerView[] = [];
  for (const { clientID, presence } of peers) {
    if (!presence) continue;
    views.push({
      clientID,
      color: getPeerCursorColor(theme, clientID),
      label: presence.username || "Anonymous",
      activeSlideId: SYNTHETIC_SLIDE_ID,
      selectedElementIds: presence.selectedElementIds,
    });
  }
  return views;
}

/**
 * BoardView mounts the reused `@wafflebase/slides` editor as an
 * infinite canvas: one unbounded plane instead of a fitted slide rect,
 * driven by a host-owned pan/zoom `Viewport` (Task 5) rather than the
 * slides "fit to column" sizing. Structurally this mirrors
 * `SlidesView` — `useDocument` for the Yorkie doc handle, a `didMount`
 * gate to dodge React strict-mode's double mount, a single mount-time
 * `useEffect` building the canvas + overlay DOM and wiring
 * `initializeEditor`, and the same store-change / presence-change /
 * RAF-render plumbing — with the slide-fitting, thumbnail/notes/ruler
 * panels, and layout-edit machinery dropped (a board has none of
 * those concepts).
 *
 * Presence: peers are read straight off the Yorkie `doc` (board's
 * `YorkieBoardStore` does not expose `getPeers`/`onPresenceChange`/
 * `updatePresence` — those are `YorkieSlidesStore`-only conveniences,
 * not part of the shared `SlidesStore` interface) using the same
 * `getOthersPresences()` / `subscribe('others', ...)` / `doc.update`
 * primitives `YorkieSlidesStore` wraps. Peer cursor DOTS are not
 * rendered yet (`mapBoardPeers` has no cursor field) — that's a
 * deferred follow-up, so this client does not publish `cursor` into
 * presence (would be pure CRDT churn with nothing reading it).
 */
export function BoardView({ documentId, readOnly, workspaceId }: BoardViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<SlidesEditor | null>(null);
  // Live pan/zoom state. A ref (not React state) because it updates on
  // every wheel tick / pointer-drag frame — routing that through
  // `setState` would re-render the whole component tree for a value
  // only the imperative canvas mount below ever reads.
  const vp = useRef<Viewport>(DEFAULT_VIEWPORT);
  // One-shot "frame the content on open" latch. A ref, not effect-local
  // state, so it outlives a mount-effect re-run (e.g. `workspaceId`
  // resolving after the first render) — re-framing then would yank a
  // viewport the user has already panned. See `createFitToContentOnce`.
  const fitLatch = useRef<FitLatch>({ done: false });
  // Assigned inside the mount effect once store/editor exist; lets the
  // toolbar trigger a sticky drop that reads the live viewport + host size.
  const stickyInserterRef = useRef<((colorValue: string) => void) | null>(null);
  // Assigned inside the mount effect (editable + workspace-known only);
  // lets the toolbar's Image button and the board's paste/drop paths
  // funnel through the same insert call, centered on the live viewport.
  const imageInserterRef = useRef<((file: File) => void) | null>(null);
  const [didMount, setDidMount] = useState(false);
  // Lifted into React state (in addition to `editorRef`) purely so the
  // toolbar can re-render with a live `editor` reference once the mount
  // effect creates it — `editorRef` alone wouldn't trigger a re-render
  // of `<BoardToolbar>` when the editor becomes available.
  const [editor, setEditor] = useState<SlidesEditor | null>(null);
  // Lifted for the same reason as `editor`: the toolbar's contextual
  // controls and Undo/Redo read element data through the store, so
  // `<BoardToolbar>` must re-render once the mount effect creates it.
  const [store, setStore] = useState<YorkieBoardStore | null>(null);
  // Ref-held singleton so it survives mount-effect re-runs (e.g.
  // `workspaceId` resolving after the first render) — a fresh controller
  // would drop the toolbar's subscription and reset the zoom readout.
  const zoomController = useRef(createBoardZoomController()).current;
  const { doc, loading, error } = useDocument<YorkieBoardRoot, BoardPresence>();

  // Same ref-capture pattern as SlidesView: the mount effect's closures
  // are built once and must read the *current* resolved theme (for peer
  // cursor colour) without re-running the whole mount on every toggle.
  const { resolvedTheme } = useTheme();
  const resolvedThemeRef = useRef(resolvedTheme);
  resolvedThemeRef.current = resolvedTheme;

  // Prevent double-initialization in React strict mode / dev HMR.
  useEffect(() => {
    setDidMount(true);
  }, []);

  useEffect(() => {
    if (!didMount || !doc) return;
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = "";
    container.style.position = "relative";
    container.style.overflow = "hidden";
    container.style.touchAction = "none";

    const dpr = window.devicePixelRatio || 1;

    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.display = "block";
    canvas.style.background = "transparent";
    container.appendChild(canvas);

    const overlay = document.createElement("div");
    overlay.style.position = "absolute";
    overlay.style.left = "0";
    overlay.style.top = "0";
    overlay.style.pointerEvents = "none";
    container.appendChild(overlay);

    // Inject pointer-events for handles (overlay-level CSS). The
    // overlay itself uses pointer-events: none so empty-area clicks
    // pass through to the canvas; handle children opt back in.
    const style = document.createElement("style");
    style.textContent = "[data-handle] { pointer-events: auto !important; }";
    document.head.appendChild(style);

    const store = new YorkieBoardStore(doc);
    setStore(store);

    // Host fills the container edge-to-edge — there is no fitted slide
    // rect to center, unlike SlidesView's `computeFitSize`/`refitCanvas`.
    const initialRect = container.getBoundingClientRect();
    let hostW = Math.max(1, Math.round(initialRect.width));
    let hostH = Math.max(1, Math.round(initialRect.height));

    const sizeCanvas = (w: number, h: number) => {
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      overlay.style.width = `${w}px`;
      overlay.style.height = `${h}px`;
    };
    sizeCanvas(hostW, hostH);

    const editor = initializeEditor({
      canvas,
      overlay,
      store,
      hostWidth: hostW,
      hostHeight: hostH,
      dpr,
      // Board-specific: an explicit pan/zoom transform instead of the
      // slides fixed fit-scale, plus AABB culling since the plane is
      // unbounded and only the visible screen rect needs painting.
      viewport: vp.current,
      cull: true,
      // A board has no slides — drop "Change layout…" (and any future
      // slide-scoped item) from the empty-canvas context menu; it maps
      // to a `notSupported()` throw on `YorkieBoardStore`.
      suppressSlideChrome: true,
      // Viewer-role share-link visitors get a read-only mount: the
      // editor still paints (including remote peer edits) but accepts
      // no pointer/keyboard input.
      readOnly,
      // "Fit to content" in the empty-canvas context menu. Wrapped in an
      // arrow because `fitToContentNow` is declared below (it needs the
      // minimap) — the call only ever happens after mount, so the
      // declaration order stays readable without hoisting.
      onFitToContent: () => fitToContentNow(),
    });
    editorRef.current = editor;
    setEditor(editor);

    const minimap: BoardMinimap = createBoardMinimap({
      store,
      dpr,
      getHostSize: () => ({ w: hostW, h: hostH }),
      onNavigate: (worldCenter) => {
        vp.current = centerViewportOnWorld(vp.current, worldCenter, { w: hostW, h: hostH });
        editor.setViewport(vp.current);
        minimap.repaintViewport(vp.current);
      },
    });
    container.appendChild(minimap.element);
    minimap.repaintScene();
    minimap.repaintViewport(vp.current);

    // Open ON the board's content instead of at the world origin. Boards sit
    // far from (0, 0) — a Miro import especially — so `DEFAULT_VIEWPORT` shows
    // a magnified empty corner and the user has to hunt for their own content.
    // Runs at mount AND on every store change until it succeeds once: the
    // Yorkie document has usually not synced yet at mount, so there is nothing
    // to frame. Read-only (share-link) mounts fit too — an unnavigable board is
    // just as useless to a viewer. Once it fires it never runs again.
    const readFrames = (): Frame[] => {
      const snapshot = store.read() as SlidesDocument;
      const slide = snapshot.slides[0] as Slide | undefined;
      return slide ? slide.elements.map((e) => e.frame) : [];
    };

    const commitViewport = (next: Viewport) => {
      vp.current = next;
      editor.setViewport(vp.current);
      minimap.repaintViewport(vp.current);
    };

    const fitToContentOnce = createFitToContentOnce({
      latch: fitLatch.current,
      getFrames: readFrames,
      getHostSize: () => ({ w: hostW, h: hostH }),
      apply: (fitted) => commitViewport(fitted),
    });
    fitToContentOnce();

    // Repeatable "frame everything" — the context menu's Fit to content
    // and the zoom dropdown's Fit both land here. Distinct from
    // `fitToContentOnce`, which is a one-shot open-time latch.
    const fitToContentNow = () => {
      const next = applyZoomValue(
        vp.current,
        FIT_ZOOM,
        { w: hostW, h: hostH },
        readFrames(),
      );
      // `undefined` means "nothing to commit" (empty scene / unsized
      // host) — leave the viewport where the user put it.
      if (next) commitViewport(next);
    };

    const offZoom = zoomController.subscribe(() => {
      const next = applyZoomValue(
        vp.current,
        zoomController.get(),
        { w: hostW, h: hostH },
        readFrames(),
      );
      if (next) commitViewport(next);
    });

    stickyInserterRef.current = (colorValue: string) => {
      dropStickyAtViewportCenter({
        store,
        editor,
        viewport: vp.current,
        hostWidth: hostW,
        hostHeight: hostH,
        colorValue,
      });
    };

    // Image input: paste + drag-drop + toolbar button, all funneling to
    // insertImageOnSlide, centered on the current viewport. Disabled in
    // read-only mode and until the workspace id resolves (upload needs it).
    let disposeImagePaths: (() => void) | undefined;
    if (!readOnly && workspaceId) {
      const upload = makeBoardImageUpload(workspaceId);
      const center = () => screenToWorld(vp.current, { x: hostW / 2, y: hostH / 2 });
      disposeImagePaths = setupSlidesImagePaths({
        canvasWrap: container,
        editor,
        store,
        upload,
        center,
      });
      imageInserterRef.current = (file: File) => {
        void insertImageOnSlide({
          store,
          slideId: SYNTHETIC_SLIDE_ID,
          file,
          upload,
          center: center(),
        }).catch((err) => {
          // Auth expiry triggers a login redirect; a stale failure toast
          // would flash on the way out — swallow it (same as the paste/drop
          // handler and the rest of the app's mutation error paths).
          if (isAuthExpiredError(err)) return;
          // Mirrors the paste/drop path's failure handling
          // (`setupSlidesImagePaths`'s internal `insert()`) and the
          // slides toolbar's `handleImagePick` — `insertImageOnSlide`
          // itself never toasts, so the toolbar-click caller must.
          console.error("Failed to insert image", err);
          toast.error("Failed to insert image");
        });
      };
    }

    // Cached canvas rect for the pointer/wheel hot paths below — a bare
    // `canvas.getBoundingClientRect()` forces a synchronous layout
    // reflow, and onWheel fires on every wheel tick. Refreshed here on
    // every ResizeObserver callback (which also covers the "no size
    // change but position shifted" case since the callback always
    // re-reads it, not just on the early-return branch below); the host
    // fills its flex parent edge-to-edge with no page-level scroll, so
    // resize is the only geometry change that matters.
    let canvasRect = canvas.getBoundingClientRect();
    const resizeObserver = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      if (w !== hostW || h !== hostH) {
        hostW = w;
        hostH = h;
        sizeCanvas(hostW, hostH);
        editor.setHostSize(hostW, hostH);
      }
      canvasRect = canvas.getBoundingClientRect();
      minimap.repaintViewport(vp.current);
    });
    resizeObserver.observe(container);

    // --- presence: peers ---
    //
    // `getOthersPresences()` / `subscribe('others', ...)` mirror
    // `YorkieSlidesStore.getPeers()` / `onPresenceChange()` verbatim —
    // read directly off `doc` since `YorkieBoardStore` doesn't wrap them
    // (see class doc comment).
    const pushPeers = () => {
      const peers = doc.getOthersPresences().map((p) => ({
        clientID: String(p.clientID),
        presence: p.presence as BoardPresence,
      }));
      editor.setPeers(mapBoardPeers(peers, resolvedThemeRef.current));
    };
    const offPeers = doc.subscribe("others", () => pushPeers());
    pushPeers();

    // Re-render on ANY store change — local batch commits OR remote
    // changes pushed in by another peer. Also refreshes peer chrome
    // (a peer's selection ring tracks elements anyone moved).
    const offChange = store.onChange(() => {
      // Before the repaints below: this is the change that first brings the
      // synced content in, and the minimap viewport rect painted afterwards
      // must reflect the framed viewport, not the stale origin one.
      fitToContentOnce();
      editor.markDirty();
      editor.render();
      pushPeers();
      minimap.repaintScene();
      minimap.repaintViewport(vp.current);
    });

    // Local presence: broadcast selection. `Presence.set` merges, so
    // only the board-specific field is passed — identity fields
    // (username/email/photo) are seeded once by the future BoardDetail
    // wrapper's `initialPresence` and stay intact across this partial
    // update, exactly like SlidesView's `broadcast()`.
    const offSelection = editor.onSelectionChange(() => {
      doc.update((_, p) => {
        p.set({ selectedElementIds: editor.getSelection().slice() });
      });
    });

    // --- wheel: ctrl/cmd zoom-at-cursor, plain pan ---
    //
    // Bound to `container`, not `canvas`: the overlay injects
    // `[data-handle] { pointer-events: auto }` so selection/resize
    // handles are hit-testable above the canvas, which means a wheel
    // tick while the cursor sits over a handle targets the handle
    // element and bubbles through `overlay`/`container` — never
    // reaching a canvas-bound listener (zoom/pan would silently stop,
    // and `preventDefault()` would never run, over a handle). `canvas`
    // and `overlay` both fill `container` exactly (no border/padding),
    // so the cached `canvasRect` below remains the correct reference
    // rect for the cursor→world offset math regardless of which
    // descendant the event originated on.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      vp.current = applyWheelToViewport(vp.current, {
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        offsetX: e.clientX - canvasRect.left,
        offsetY: e.clientY - canvasRect.top,
      });
      editor.setViewport(vp.current);
      minimap.repaintViewport(vp.current);
      // Reflect wheel/pinch zoom in the toolbar readout. `set` is a
      // no-op when the value is unchanged (a pan tick), so this does
      // not churn subscribers — and the subscriber it would notify
      // recomputes from the same viewport, so there is no feedback loop.
      zoomController.set(vp.current.zoom);
    };
    container.addEventListener("wheel", onWheel, { passive: false });

    // --- space-drag / middle-drag pan ---
    let spaceDown = false;
    let panning = false;
    let panPointerId: number | null = null;
    let panLastX = 0;
    let panLastY = 0;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || spaceDown) return;
      // Don't hijack Space when a regular editable field has focus (the
      // SiteHeader rename input, the Share dialog, any other
      // input/textarea/contenteditable) — it must type a literal space
      // there, not enter pan mode.
      if (isEditableTarget(e.target)) return;
      // Don't hijack Space from an in-progress text edit (it must type
      // a space character there, not enter pan mode).
      if (editor.isTextEditing()) return;
      spaceDown = true;
      e.preventDefault();
      canvas.style.cursor = "grab";
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      spaceDown = false;
      if (!panning) canvas.style.cursor = "";
    };
    // If Space is held and the window loses focus (tab away, switch
    // app) before `keyup` fires, `spaceDown` would otherwise latch
    // true forever — the cursor stays stuck at "grab" and the next
    // drag pans instead of selecting. `blur` is the only reliable
    // signal here (no `keyup` is guaranteed to follow).
    const onWindowBlur = () => {
      spaceDown = false;
      if (!panning) canvas.style.cursor = "";
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);

    const onPointerDown = (e: PointerEvent) => {
      const isMiddleButton = e.button === 1;
      const isSpaceDrag = spaceDown && e.button === 0;
      if (!isMiddleButton && !isSpaceDrag) return;
      e.preventDefault();
      // Registered on `container` (an ancestor of both the reused
      // editor's canvas and overlay) in the CAPTURE phase, and only
      // once we've decided to actually claim the gesture: this halts
      // dispatch before the event ever reaches the editor's own
      // canvas/overlay pointerdown listeners, so a space/middle-drag
      // pan never also starts a marquee-select or deselect underneath
      // it. `stopPropagation()` on a bubble-phase listener attached
      // directly to `canvas` would be too late for this — the editor's
      // listener is registered on that same element earlier (inside
      // `initializeEditor`) and same-element listeners always fire in
      // registration order regardless of the `capture` flag. A normal
      // click/drag (neither branch above) falls through untouched, so
      // element selection/drag/resize still reach the editor.
      e.stopPropagation();
      panning = true;
      panPointerId = e.pointerId;
      panLastX = e.clientX;
      panLastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!panning || e.pointerId !== panPointerId) return;
      const dx = e.clientX - panLastX;
      const dy = e.clientY - panLastY;
      panLastX = e.clientX;
      panLastY = e.clientY;
      vp.current = { ...vp.current, panX: vp.current.panX + dx, panY: vp.current.panY + dy };
      editor.setViewport(vp.current);
      minimap.repaintViewport(vp.current);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!panning || e.pointerId !== panPointerId) return;
      panning = false;
      panPointerId = null;
      canvas.releasePointerCapture(e.pointerId);
      canvas.style.cursor = spaceDown ? "grab" : "";
    };
    container.addEventListener("pointerdown", onPointerDown, { capture: true });
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    // RAF loop so async asset loads (e.g. the image cache backing image
    // elements) repaint — mirrors SlidesView's render loop.
    //
    // `render()` short-circuits at idle: it returns BEFORE calling
    // `store.read()` when the renderer is clean and no text-edit or
    // crop session is active. That guard is load-bearing here — a board
    // is one unbounded slide, so `YorkieBoardStore.read()` deep-unwraps
    // the entire document (a `JSON.parse` per element `frame`/`data`).
    //
    // An earlier version of this comment claimed the loop was already
    // cheap "because render() no-ops when the renderer isn't dirty".
    // That was false: the no-op lived inside `SlideRenderer.render()`,
    // i.e. *after* the read. An idle board with ~3000 elements burnt
    // ~65 ms and ~12.6k `JSON.parse` calls per frame (≈15 fps).
    let raf = 0;
    const tick = () => {
      editor.render();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("pointerdown", onPointerDown, { capture: true });
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
      cancelAnimationFrame(raf);
      offSelection();
      offChange();
      offPeers();
      offZoom();
      minimap.dispose();
      editor.detach();
      store.dispose();
      editorRef.current = null;
      setEditor(null);
      setStore(null);
      stickyInserterRef.current = null;
      disposeImagePaths?.();
      imageInserterRef.current = null;
      style.remove();
    };
    // `zoomController` is a ref-held singleton with a stable identity for
    // the component's lifetime, so listing it never re-runs this effect —
    // it is here only to satisfy exhaustive-deps.
  }, [didMount, doc, readOnly, workspaceId, zoomController]);

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-red-500">{error.message}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full min-h-0 flex-col">
      {/* Toolbar sits ABOVE the canvas host as a sibling, not a wrapper —
          the mount effect measures `containerRef.getBoundingClientRect()`
          for canvas sizing and `canvas.getBoundingClientRect()` for
          pointer→world mapping, so the toolbar must not add to (or live
          inside) that measured box. Hidden entirely for viewer-role
          share-link visitors, matching every other insert affordance. */}
      {!readOnly && (
        <BoardToolbar
          editor={editor}
          store={store}
          zoomController={zoomController}
          onInsertSticky={(color) => stickyInserterRef.current?.(color)}
          onInsertImage={(file) => imageInserterRef.current?.(file)}
          disabled={!workspaceId}
        />
      )}
      <div
        ref={containerRef}
        data-document-id={documentId}
        className="relative flex-1 w-full h-full min-h-0"
      />
    </div>
  );
}

export default BoardView;
