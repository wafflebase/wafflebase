import type { Viewport } from "@wafflebase/board";
import type { BoardLaserTrail, BoardPresence } from "@/types/board-document";
import {
  StrokeAccumulator,
  decodeLivePoints,
  encodeLivePoints,
  strokeWindow,
} from "./board-live-ink";

/**
 * The laser pointer (Shift+K): a red trail that follows a drag and fades
 * out over {@link LASER_FADE_MS}, for everyone on the board. Pure
 * presence — nothing about it is ever written to the document.
 *
 * Board-local, like the hand tool: it inserts nothing, so it is not a
 * slides `InsertKind`. Drawn on its own canvas over the scene (not the
 * editor's live-ink layer, whose strokes are opaque and do not age).
 *
 * Each point is stamped with the time THIS client learnt of it — a local
 * pointer sample, or a presence write carrying it — and fades from then.
 * No clock is shared, so a peer's trail fades on the peer's schedule as
 * it arrives, never by a remote timestamp that a skewed clock would
 * shorten or stretch. Presence carries the same 64-point window the live
 * stroke does (see `board-live-ink.ts`).
 *
 * Under `prefers-reduced-motion` the trail becomes a static dot at the
 * pointer, shown while the laser is live and for the fade period after.
 */

export const LASER_FADE_MS = 1500;
const LASER_COLOR = "#FF3B30";
/** Trail width in SCREEN px: a pointer, so it does not scale with zoom. */
const LASER_WIDTH = 4;

type Pt = { x: number; y: number };
type TimedPt = Pt & { t: number };

/** Opacity of a point `age` ms old: linear fade to 0 at {@link LASER_FADE_MS}. */
export function laserAlpha(age: number): number {
  if (age <= 0) return 1;
  if (age >= LASER_FADE_MS) return 0;
  return 1 - age / LASER_FADE_MS;
}

/** Drop points that have fully faded. */
export function pruneTrail(trail: TimedPt[], now: number): TimedPt[] {
  let i = 0;
  while (i < trail.length && now - trail[i].t >= LASER_FADE_MS) i++;
  return i === 0 ? trail : trail.slice(i);
}

interface Trail {
  points: TimedPt[];
  /** Points of the current presence stroke already stamped (peers only). */
  acc: StrokeAccumulator | null;
  known: number;
}

export interface LaserLayer {
  /** Add a local pointer sample (world). */
  addLocal(p: Pt): void;
  /** Feed every `others` change. */
  updatePeers(peers: readonly { clientID: string; presence: Partial<BoardPresence> }[]): void;
  dispose(): void;
}

export function createLaserLayer(deps: {
  container: HTMLElement;
  getViewport: () => Viewport;
  getHost: () => { w: number; h: number };
  dpr: number;
  reducedMotion: () => boolean;
  now?: () => number;
  requestFrame?: (cb: () => void) => number;
  cancelFrame?: (h: number) => void;
}): LaserLayer {
  const now = deps.now ?? (() => performance.now());
  const requestFrame = deps.requestFrame ?? ((cb) => requestAnimationFrame(cb));
  const cancelFrame = deps.cancelFrame ?? ((h) => cancelAnimationFrame(h));
  const canvas = document.createElement("canvas");
  canvas.dataset.boardLaser = "";
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;z-index:3";
  deps.container.appendChild(canvas);

  const trails = new Map<string, Trail>();
  let raf: number | null = null;

  const trailOf = (key: string): Trail => {
    let t = trails.get(key);
    if (!t) {
      t = { points: [], acc: null, known: 0 };
      trails.set(key, t);
    }
    return t;
  };

  const paint = () => {
    raf = null;
    const host = deps.getHost();
    const w = Math.max(1, Math.round(host.w * deps.dpr));
    const h = Math.max(1, Math.round(host.h * deps.dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    canvas.style.width = `${host.w}px`;
    canvas.style.height = `${host.h}px`;
    const ctx = canvas.getContext("2d");
    const t = now();
    let live = false;
    for (const [key, trail] of trails) {
      trail.points = pruneTrail(trail.points, t);
      if (trail.points.length === 0 && trail.acc === null) trails.delete(key);
      else if (trail.points.length > 0) live = true;
    }
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(deps.dpr, 0, 0, deps.dpr, 0, 0);
      const vp = deps.getViewport();
      const toScreen = (p: Pt) => ({ x: p.x * vp.zoom + vp.panX, y: p.y * vp.zoom + vp.panY });
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = LASER_COLOR;
      ctx.fillStyle = LASER_COLOR;
      for (const trail of trails.values()) {
        const pts = trail.points;
        if (pts.length === 0) continue;
        if (deps.reducedMotion()) {
          // A static dot, no motion: shown until the fade period ends.
          const last = toScreen(pts[pts.length - 1]);
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.arc(last.x, last.y, LASER_WIDTH * 1.5, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        ctx.lineWidth = LASER_WIDTH;
        for (let i = 1; i < pts.length; i++) {
          ctx.globalAlpha = laserAlpha(t - pts[i].t);
          const a = toScreen(pts[i - 1]);
          const b = toScreen(pts[i]);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        const head = pts[pts.length - 1];
        const hs = toScreen(head);
        ctx.globalAlpha = laserAlpha(t - head.t);
        ctx.beginPath();
        ctx.arc(hs.x, hs.y, LASER_WIDTH, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (live) raf = requestFrame(paint);
  };
  const kick = () => {
    if (raf === null) raf = requestFrame(paint);
  };

  return {
    addLocal(p) {
      trailOf("local").points.push({ ...p, t: now() });
      kick();
    },
    updatePeers(peers) {
      const seen = new Set<string>();
      for (const { clientID, presence } of peers) {
        const laser = presence.laser;
        const key = `peer:${clientID}`;
        if (!isLaserTrail(laser)) {
          const t = trails.get(key);
          if (t) t.acc = null; // stops growing; what is there fades out
          continue;
        }
        const window = decodeLivePoints(laser.points);
        if (window.length === 0) continue;
        seen.add(key);
        const trail = trailOf(key);
        if (!trail.acc || trail.acc.id !== laser.id) {
          trail.acc = new StrokeAccumulator();
          trail.known = 0;
        }
        const all = trail.acc.apply(laser.id, laser.base, window);
        // Stamp only the points not seen before; earlier ones keep their age.
        const stamp = now();
        for (let i = trail.known; i < all.length; i++) {
          trail.points.push({ ...all[i], t: stamp });
        }
        trail.known = all.length;
      }
      for (const [key, trail] of trails) {
        if (key.startsWith("peer:") && !seen.has(key)) trail.acc = null;
      }
      kick();
    },
    dispose() {
      if (raf !== null) cancelFrame(raf);
      raf = null;
      trails.clear();
      canvas.remove();
    },
  };
}

export function isLaserTrail(value: unknown): value is BoardLaserTrail {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "number" && typeof v.base === "number" && v.base >= 0 && typeof v.points === "string";
}

/** The presence write for a local laser drag so far. */
export function laserPresence(id: number, points: readonly Pt[]): BoardLaserTrail {
  const win = strokeWindow(points);
  return { id, base: win.base, points: encodeLivePoints(win.points) };
}
