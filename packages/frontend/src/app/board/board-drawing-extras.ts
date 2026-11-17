import { screenToWorld, type Viewport } from "@wafflebase/board";
import type { SlidesEditor, SlidesEditorOptions } from "@wafflebase/slides";
import type { BoardLaserTrail, BoardPresence } from "@/types/board-document";
import { createHandTool, type HandTool } from "./board-hand";
import type { InkTool } from "./board-ink";
import { createThrottledPublisher } from "./board-cursor-publish";
import {
  LIVE_STROKE_INTERVAL_MS,
  createLiveStrokePublisher,
  createLiveStrokeReceiver,
  liveStyle,
} from "./board-live-ink";
import { createLaserLayer, laserPresence } from "./board-laser";
import { recognizeStroke, smartShapeInits } from "./board-smart-shapes";

/**
 * The board's drawing extras, wired in one place so `BoardView` only
 * spreads {@link BoardDrawingExtras.editorOptions} into the editor and
 * calls `attach` once it exists (the shape `createBoardSections` uses):
 *
 * - **live ink** — the stroke being drawn rides in presence
 *   (`board-live-ink.ts`) and peers' strokes paint on the editor's
 *   live-ink layer;
 * - **laser pointer** (Shift+K) — a fading, presence-only trail
 *   (`board-laser.ts`);
 * - **lasso select** — Alt+drag on empty canvas, or the toolbar toggle,
 *   draws a free-form loop (the editor's `freeLasso` option);
 * - **smart shapes** — a recognised box / loop / line / arrow replaces the
 *   marker stroke in the same undo unit (`board-smart-shapes.ts`).
 *
 * Presence is written only through `store.updatePresence`, never on a
 * read-only mount, and only while someone else is on the board.
 */

/** Key hints for the drawing extras (the keys live in `board-shortcuts.ts`). */
export const DRAWING_HINTS = {
  laser: "Shift+K",
  lasso: "Alt+drag",
} as const;

/** A board-local on/off tool (the hand tool's shape). */
export type ToggleTool = HandTool;

/** The laser and lasso toggles, ref-held by `BoardView` like the hand. */
export interface DrawingTools {
  laser: ToggleTool;
  lasso: ToggleTool;
}

export function createDrawingTools(): DrawingTools {
  return { laser: createHandTool(), lasso: createHandTool() };
}

/** The slice of the Yorkie document this module reads. */
export interface DrawingPresenceDoc {
  getOthersPresences(): { clientID: string | number; presence: unknown }[];
  subscribe(type: "others", cb: () => void): () => void;
}

/** A tool owned elsewhere that must stand down while ours is armed. */
interface ExclusiveTool {
  get(): boolean;
  set(on: boolean): void;
  subscribe(cb: () => void): () => void;
}

export interface DrawingAttachDeps {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  overlay: HTMLElement;
  getViewport: () => Viewport;
  getHost: () => { w: number; h: number };
  getCanvasRect: () => { left: number; top: number };
  dpr: number;
  hand: ExclusiveTool;
  sectionTool: ExclusiveTool;
  /** The ritual tools (stamps / comments), when the board has them. */
  ritualTool?: {
    get(): { mode: string };
    setMode(mode: "none"): void;
    subscribe(cb: () => void): () => void;
  } | null;
}

export interface BoardDrawingExtras {
  editorOptions: Pick<SlidesEditorOptions, "onInkProgress" | "transformInkStroke" | "freeLasso">;
  /** Wire the receivers, the laser and tool exclusivity; returns detach. */
  attach(deps: DrawingAttachDeps): () => void;
}

/** Laser cursor, enforced over the editor's own hover cursor (see `BOARD_PAN_CURSOR_CSS`). */
export const BOARD_LASER_CURSOR_CSS = `
[data-board-laser], [data-board-laser] * { cursor: crosshair !important; }
`;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function createBoardDrawingExtras(deps: {
  doc: DrawingPresenceDoc;
  store: { updatePresence(p: Partial<BoardPresence>): void };
  readOnly: boolean;
  ink: InkTool;
  tools: DrawingTools;
  getEditor: () => SlidesEditor | null;
}): BoardDrawingExtras {
  const { doc, store, readOnly, ink, tools } = deps;
  const timers = {
    now: () => performance.now(),
    setTimer: (cb: () => void, ms: number) => setTimeout(cb, ms),
    clearTimer: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const hasAudience = () => doc.getOthersPresences().length > 0;

  const strokePub = readOnly
    ? null
    : createLiveStrokePublisher({
        ...timers,
        shouldPublish: hasAudience,
        publish: (stroke) => store.updatePresence({ stroke }),
        style: () => liveStyle(ink.get()),
      });

  const editorOptions: BoardDrawingExtras["editorOptions"] = {
    onInkProgress: (points) => strokePub?.progress(points),
    transformInkStroke: (points, stroke) => {
      const state = ink.get();
      if (!state.smartShapes || state.pen !== "marker") return null;
      const shape = recognizeStroke(points);
      return shape ? smartShapeInits(shape, stroke) : null;
    },
    freeLasso: (press) => !readOnly && (press.altKey || tools.lasso.get()),
  };

  const attach = (a: DrawingAttachDeps): (() => void) => {
    const editor = deps.getEditor();
    const offs: Array<() => void> = [];

    // --- peers: live strokes and laser trails ---------------------------
    const receiver = createLiveStrokeReceiver({
      setPeerStroke: (id, stroke) => deps.getEditor()?.setPeerInkStroke(id, stroke),
    });
    const laserLayer = createLaserLayer({
      container: a.container,
      getViewport: a.getViewport,
      getHost: a.getHost,
      dpr: a.dpr,
      reducedMotion: prefersReducedMotion,
    });
    const laserPub = readOnly
      ? null
      : createThrottledPublisher<BoardLaserTrail | null>({
          ...timers,
          intervalMs: LIVE_STROKE_INTERVAL_MS,
          restMs: 100,
          equals: (x, y) =>
            x === null || y === null
              ? x === y
              : x.id === y.id && x.base === y.base && x.points === y.points,
          shouldPublish: hasAudience,
          publish: (laser) => store.updatePresence({ laser }),
        });

    let hadPeers = false;
    const onOthers = () => {
      const peers = doc.getOthersPresences().map((p) => ({
        clientID: String(p.clientID),
        presence: (p.presence ?? {}) as Partial<BoardPresence>,
      }));
      receiver.update(peers);
      laserLayer.updatePeers(peers);
      const hasPeers = peers.length > 0;
      if (hasPeers && !hadPeers) {
        strokePub?.resend();
        laserPub?.resend();
      }
      hadPeers = hasPeers;
    };
    offs.push(doc.subscribe("others", onOthers));
    onOthers();

    // --- laser capture ---------------------------------------------------
    let laserId = 0;
    let laserPoints: { x: number; y: number }[] = [];
    let laserPointer: number | null = null;
    const toWorld = (e: { clientX: number; clientY: number }) => {
      const rect = a.getCanvasRect();
      return screenToWorld(a.getViewport(), { x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    const addLaserPoint = (e: { clientX: number; clientY: number }) => {
      const p = toWorld(e);
      laserPoints.push(p);
      laserLayer.addLocal(p);
      laserPub?.queue(laserPresence(laserId, laserPoints));
    };
    const onLaserMove = (e: PointerEvent) => {
      if (e.pointerId !== laserPointer) return;
      const samples = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      for (const s of samples.length > 0 ? samples : [e]) addLaserPoint(s);
    };
    const endLaser = (e: PointerEvent) => {
      if (e.pointerId !== laserPointer) return;
      laserPointer = null;
      laserPoints = [];
      laserPub?.queue(null);
      document.removeEventListener("pointermove", onLaserMove);
      document.removeEventListener("pointerup", endLaser);
      document.removeEventListener("pointercancel", endLaser);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (readOnly || !tools.laser.get() || laserPointer !== null) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const onScene =
        e.target instanceof Node && (e.target === a.canvas || a.overlay.contains(e.target));
      if (!onScene) return;
      // Ahead of the pan claim, the touch recognizer and the editor: a
      // laser drag is neither a selection nor a pan.
      e.preventDefault();
      e.stopImmediatePropagation();
      laserPointer = e.pointerId;
      laserId += 1;
      laserPoints = [];
      addLaserPoint(e);
      document.addEventListener("pointermove", onLaserMove);
      document.addEventListener("pointerup", endLaser);
      document.addEventListener("pointercancel", endLaser);
    };
    a.container.addEventListener("pointerdown", onPointerDown, { capture: true });
    offs.push(() => {
      a.container.removeEventListener("pointerdown", onPointerDown, { capture: true });
      document.removeEventListener("pointermove", onLaserMove);
      document.removeEventListener("pointerup", endLaser);
      document.removeEventListener("pointercancel", endLaser);
    });

    // --- one live tool at a time ------------------------------------------
    const syncLaserCursor = () => {
      for (const el of [a.canvas, a.overlay]) {
        if (tools.laser.get()) el.dataset.boardLaser = "";
        else delete el.dataset.boardLaser;
      }
    };
    const disarmOthers = () => {
      a.hand.set(false);
      a.sectionTool.set(false);
      a.ritualTool?.setMode("none");
      if (editor && editor.getInsertMode() !== null) editor.setInsertMode(null);
    };
    offs.push(
      tools.laser.subscribe(() => {
        syncLaserCursor();
        if (!tools.laser.get()) return;
        tools.lasso.set(false);
        disarmOthers();
        if (editor?.isTextEditing()) editor.exitTextEditing();
        editor?.clearSelectionAndScope();
      }),
      tools.lasso.subscribe(() => {
        if (!tools.lasso.get()) return;
        tools.laser.set(false);
        disarmOthers();
      }),
    );
    const standDown = () => {
      tools.laser.set(false);
      tools.lasso.set(false);
    };
    if (editor) {
      offs.push(
        editor.onInsertModeChange(() => {
          if (editor.getInsertMode() !== null) standDown();
        }),
      );
    }
    offs.push(a.hand.subscribe(() => a.hand.get() && standDown()));
    offs.push(a.sectionTool.subscribe(() => a.sectionTool.get() && standDown()));
    if (a.ritualTool) {
      const ritual = a.ritualTool;
      offs.push(ritual.subscribe(() => ritual.get().mode !== "none" && standDown()));
    }
    // Esc returns to Select from these tools as from any other.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") standDown();
    };
    document.addEventListener("keydown", onKey);
    offs.push(() => document.removeEventListener("keydown", onKey));
    syncLaserCursor();

    return () => {
      for (const off of offs) off();
      standDown();
      delete a.canvas.dataset.boardLaser;
      delete a.overlay.dataset.boardLaser;
      laserPub?.dispose();
      strokePub?.dispose();
      receiver.dispose();
      laserLayer.dispose();
    };
  };

  return { editorOptions, attach };
}
