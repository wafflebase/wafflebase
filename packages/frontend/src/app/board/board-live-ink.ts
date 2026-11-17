import type { LiveStroke } from "@wafflebase/slides";
import type { BoardLiveStroke, BoardPresence } from "@/types/board-document";
import {
  createThrottledPublisher,
  type ThrottledPublisher,
} from "./board-cursor-publish";
import { HIGHLIGHTER_ALPHA, INK_WIDTHS, type InkState } from "./board-ink";

/**
 * Live ink over presence (docs/design/board/board-figjam-parity.md
 * § Second pass C): while a user draws, their stroke rides in presence so
 * peers watch the line appear; on release the finished stroke lands in the
 * document and the presence stroke is cleared.
 *
 * **Bounded payload: a sliding window.** Presence is state, not a log:
 * each write replaces the last, and a peer may coalesce several. Sending
 * the whole stroke on every write self-heals perfectly but grows without
 * bound (a long doodle would push kilobytes every 40 ms). Sending only the
 * points added since the last write is small but loses a segment whenever
 * a peer misses a write. So each write carries the LAST
 * {@link LIVE_STROKE_WINDOW} points plus `base`, the index of the first of
 * them in the whole stroke:
 *
 * - A write is at most 64 points (~0.5 KB), however long the stroke.
 * - Consecutive writes overlap heavily (40 ms adds a handful of points),
 *   so a peer that misses or coalesces writes still splices the next one
 *   onto what it has, at `base`, without a gap.
 * - Only a peer that misses more than a whole window — or joins mid-
 *   stroke — sees a gap, bridged by a straight segment, until the commit
 *   replaces the live line with the real one a moment later.
 *
 * `id` numbers this client's strokes, so a peer that never saw one
 * stroke's `null` still starts the next one fresh.
 *
 * Points are world coordinates quantised to 1/{@link LIVE_QUANTUM} of a
 * unit and delta-encoded into one string, like the committed path.
 */

/** Points per presence write. */
export const LIVE_STROKE_WINDOW = 64;
/** Quantisation steps per world unit (0.1 px at 100%). */
const LIVE_QUANTUM = 10;
/** The stroke publisher's send interval, the cursor's. */
export const LIVE_STROKE_INTERVAL_MS = 40;

type Pt = { x: number; y: number };

/** Delta-encode world points: `x,y` pairs of quantised steps, `;`-separated. */
export function encodeLivePoints(points: readonly Pt[]): string {
  let lx = 0;
  let ly = 0;
  const parts: string[] = [];
  for (const p of points) {
    const x = Math.round(p.x * LIVE_QUANTUM);
    const y = Math.round(p.y * LIVE_QUANTUM);
    parts.push(`${x - lx},${y - ly}`);
    lx = x;
    ly = y;
  }
  return parts.join(";");
}

/** Inverse of {@link encodeLivePoints}; malformed input yields `[]`. */
export function decodeLivePoints(packed: unknown): Pt[] {
  if (typeof packed !== "string" || packed === "") return [];
  let lx = 0;
  let ly = 0;
  const out: Pt[] = [];
  for (const part of packed.split(";")) {
    const m = /^(-?\d+),(-?\d+)$/.exec(part);
    if (!m) return [];
    lx += Number(m[1]);
    ly += Number(m[2]);
    out.push({ x: lx / LIVE_QUANTUM, y: ly / LIVE_QUANTUM });
  }
  return out;
}

/** The window a write carries: the last `size` points and where they start. */
export function strokeWindow(
  points: readonly Pt[],
  size = LIVE_STROKE_WINDOW,
): { base: number; points: Pt[] } {
  const base = Math.max(0, points.length - size);
  return { base, points: points.slice(base) };
}

/**
 * A peer's stroke as rebuilt from windows. `apply` splices a window in at
 * its `base` (overwriting the overlap, which also follows a Shift-held
 * straight line whose end keeps moving), appends across a gap, and starts
 * over for a new stroke id.
 */
export class StrokeAccumulator {
  id: number | null = null;
  points: Pt[] = [];

  apply(id: number, base: number, window: readonly Pt[]): Pt[] {
    if (id !== this.id) {
      this.id = id;
      this.points = [];
    }
    if (base <= this.points.length) {
      this.points = this.points.slice(0, base).concat(window);
    } else {
      this.points = this.points.concat(window);
    }
    return this.points;
  }
}

/** `#RRGGBB` + alpha → a CSS colour the live layer can paint. */
export function cssColor(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  if (alpha >= 1) return `#${m[1]}`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Whether a presence value looks like a live stroke this client can draw. */
export function isLiveStroke(value: unknown): value is BoardLiveStroke {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "number" &&
    typeof v.base === "number" &&
    v.base >= 0 &&
    typeof v.color === "string" &&
    typeof v.width === "number" &&
    v.width > 0 &&
    v.width <= 200 &&
    typeof v.alpha === "number" &&
    typeof v.points === "string"
  );
}

/** The stroke style a pen draws with, as presence carries it. */
export function liveStyle(state: InkState): Pick<BoardLiveStroke, "tool" | "color" | "width" | "alpha"> {
  const pen = state.pen;
  return {
    tool: pen,
    color: state[pen].color,
    width: INK_WIDTHS[pen][state[pen].width],
    alpha: pen === "highlighter" ? HIGHLIGHTER_ALPHA : 1,
  };
}

const sameStroke = (a: BoardLiveStroke | null, b: BoardLiveStroke | null) =>
  a === null || b === null
    ? a === b
    : a.id === b.id && a.base === b.base && a.points === b.points;

export interface LiveStrokePublisher {
  /** The editor's `onInkProgress`: the stroke so far, or null at its end. */
  progress(points: readonly Pt[] | null): void;
  /** The audience opened: deliver what the gate swallowed. */
  resend(): void;
  dispose(): void;
}

export function createLiveStrokePublisher(deps: {
  now: () => number;
  setTimer: (cb: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
  shouldPublish: () => boolean;
  publish: (stroke: BoardLiveStroke | null) => void;
  /** Read at the start of each stroke. */
  style: () => Pick<BoardLiveStroke, "tool" | "color" | "width" | "alpha">;
}): LiveStrokePublisher {
  const pub: ThrottledPublisher<BoardLiveStroke | null> = createThrottledPublisher({
    now: deps.now,
    setTimer: deps.setTimer,
    clearTimer: deps.clearTimer,
    publish: deps.publish,
    shouldPublish: deps.shouldPublish,
    equals: sameStroke,
    intervalMs: LIVE_STROKE_INTERVAL_MS,
    restMs: 100,
  });
  let id = 0;
  let style: ReturnType<typeof deps.style> | null = null;
  return {
    progress(points) {
      if (points === null) {
        style = null;
        pub.queue(null);
        return;
      }
      if (style === null) {
        id += 1;
        style = deps.style();
      }
      const win = strokeWindow(points);
      pub.queue({ ...style, id, base: win.base, points: encodeLivePoints(win.points) });
    },
    resend: () => pub.resend(),
    dispose: () => pub.dispose(),
  };
}

/**
 * Peers' live strokes → the editor's live-ink layer, keyed by client id.
 * Feed it every `others` change; it adds, updates and removes.
 */
export function createLiveStrokeReceiver(deps: {
  setPeerStroke: (clientID: string, stroke: LiveStroke | null) => void;
}): {
  update(peers: readonly { clientID: string; presence: Partial<BoardPresence> }[]): void;
  dispose(): void;
} {
  const accs = new Map<string, StrokeAccumulator>();
  return {
    update(peers) {
      const seen = new Set<string>();
      for (const { clientID, presence } of peers) {
        const s = presence.stroke;
        if (!isLiveStroke(s)) continue;
        const window = decodeLivePoints(s.points);
        if (window.length === 0) continue;
        seen.add(clientID);
        let acc = accs.get(clientID);
        if (!acc) {
          acc = new StrokeAccumulator();
          accs.set(clientID, acc);
        }
        const points = acc.apply(s.id, s.base, window);
        deps.setPeerStroke(clientID, {
          points: points.slice(),
          color: cssColor(s.color, s.alpha),
          width: s.width,
          cap: "round",
        });
      }
      for (const id of [...accs.keys()]) {
        if (seen.has(id)) continue;
        accs.delete(id);
        deps.setPeerStroke(id, null);
      }
    },
    dispose() {
      for (const id of accs.keys()) deps.setPeerStroke(id, null);
      accs.clear();
    },
  };
}
