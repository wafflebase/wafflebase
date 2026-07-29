import {
  initializeEditor,
  type PeerView,
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
import { Loader } from "@/components/loader";
import { useTheme } from "@/components/theme-provider";
import type { BoardPresence, YorkieBoardRoot } from "@/types/board-document";
import { YorkieBoardStore } from "./yorkie-board-store";
import { applyWheelToViewport } from "./board-wheel";
import { BoardToolbar } from "./board-toolbar";

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
 * primitives `YorkieSlidesStore` wraps. Each client publishes its
 * cursor in WORLD coordinates (via `screenToWorld`) on pointer move,
 * rAF-throttled to one `doc.update` per frame so a fast mouse doesn't
 * flood the CRDT with presence churn.
 */
export function BoardView({ documentId, readOnly }: BoardViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<SlidesEditor | null>(null);
  // Live pan/zoom state. A ref (not React state) because it updates on
  // every wheel tick / pointer-drag frame — routing that through
  // `setState` would re-render the whole component tree for a value
  // only the imperative canvas mount below ever reads.
  const vp = useRef<Viewport>(DEFAULT_VIEWPORT);
  const [didMount, setDidMount] = useState(false);
  // Lifted into React state (in addition to `editorRef`) purely so the
  // toolbar can re-render with a live `editor` reference once the mount
  // effect creates it — `editorRef` alone wouldn't trigger a re-render
  // of `<BoardToolbar>` when the editor becomes available.
  const [editor, setEditor] = useState<SlidesEditor | null>(null);
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
    });
    editorRef.current = editor;
    setEditor(editor);

    const resizeObserver = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      if (w === hostW && h === hostH) return;
      hostW = w;
      hostH = h;
      sizeCanvas(hostW, hostH);
      editor.setHostSize(hostW, hostH);
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
      editor.markDirty();
      editor.render();
      pushPeers();
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
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      vp.current = applyWheelToViewport(vp.current, {
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
      });
      editor.setViewport(vp.current);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });

    // --- space-drag / middle-drag pan ---
    let spaceDown = false;
    let panning = false;
    let panPointerId: number | null = null;
    let panLastX = 0;
    let panLastY = 0;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || spaceDown) return;
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
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);

    // rAF-throttled cursor presence: coalesce every pointermove within a
    // frame into a single `doc.update`, so a fast mouse doesn't flood
    // the CRDT with a presence write per native mousemove event.
    let pendingCursor: { x: number; y: number } | null = null;
    let cursorRaf = 0;
    const flushCursor = () => {
      cursorRaf = 0;
      if (!pendingCursor) return;
      const cursor = pendingCursor;
      pendingCursor = null;
      doc.update((_, p) => p.set({ cursor }));
    };

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
      if (panning && e.pointerId === panPointerId) {
        const dx = e.clientX - panLastX;
        const dy = e.clientY - panLastY;
        panLastX = e.clientX;
        panLastY = e.clientY;
        vp.current = { ...vp.current, panX: vp.current.panX + dx, panY: vp.current.panY + dy };
        editor.setViewport(vp.current);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      pendingCursor = screenToWorld(vp.current, {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
      if (!cursorRaf) cursorRaf = requestAnimationFrame(flushCursor);
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
    // elements) repaint — mirrors SlidesView's render loop. `render()`
    // no-ops when the renderer isn't dirty, so this is cheap at idle.
    let raf = 0;
    const tick = () => {
      editor.render();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      resizeObserver.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      container.removeEventListener("pointerdown", onPointerDown, { capture: true });
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      if (cursorRaf) cancelAnimationFrame(cursorRaf);
      cancelAnimationFrame(raf);
      offSelection();
      offChange();
      offPeers();
      editor.detach();
      store.dispose();
      editorRef.current = null;
      setEditor(null);
      style.remove();
    };
  }, [didMount, doc, readOnly]);

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
      {!readOnly && <BoardToolbar editor={editor} />}
      <div
        ref={containerRef}
        data-document-id={documentId}
        className="relative flex-1 w-full h-full min-h-0"
      />
    </div>
  );
}

export default BoardView;
