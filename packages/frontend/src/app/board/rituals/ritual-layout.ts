import { worldToScreen, type Frame, type Viewport } from "@wafflebase/slides";
import type { BoardAnchor, Thread } from "@/types/comments";
import { frameFractionToWorld } from "./frame-fraction";
import { resolveBoardAnchor } from "./board-anchor";
import { stampGlyph, stampsByElement } from "./stamps";
import type { BoardStamp, BoardStamps } from "./types";

/** Screen size of a stamp at zoom 1, and its clamp at other zooms. */
const STAMP_BASE = 28;
const STAMP_MIN = 14;
const STAMP_MAX = 44;
/** Own-vote dots and result badges are screen-sized. */
export const VOTE_DOT = 16;
export const RESULT_BADGE = 26;
export const PIN_SIZE = 28;

export function stampSize(zoom: number): number {
  return Math.min(STAMP_MAX, Math.max(STAMP_MIN, STAMP_BASE * zoom));
}

export interface StampItem {
  key: string;
  stamp: BoardStamp;
  glyph: string;
  /** Centre, in host-relative screen px. */
  x: number;
  y: number;
  size: number;
  mine: boolean;
}

export interface VoteDotItem {
  key: string;
  elementId: string;
  x: number;
  y: number;
}

export interface ResultBadgeItem {
  key: string;
  elementId: string;
  votes: number;
  x: number;
  y: number;
}

export interface PinItem {
  key: string;
  threadId: string | null;
  /** The anchor point (the pin's tip), host-relative screen px. */
  x: number;
  y: number;
  label: string;
  count: number;
  active: boolean;
  orphan: boolean;
  pending: boolean;
}

export interface RitualLayoutInput {
  viewport: Viewport;
  /** World frames of the board's TOP-LEVEL elements. */
  frames: ReadonlyMap<string, Frame>;
  stamps: BoardStamps | undefined;
  myKey: string | null;
  /** This user's open-session votes per element (only theirs are shown). */
  myVotes: ReadonlyMap<string, number>;
  /** Final counts per element once a session has ended, else empty. */
  results: ReadonlyMap<string, number>;
  threads: ReadonlyArray<Thread<BoardAnchor>>;
  activeThreadId: string | null;
  pending: BoardAnchor | null;
}

export interface RitualLayout {
  stamps: StampItem[];
  voteDots: VoteDotItem[];
  results: ResultBadgeItem[];
  pins: PinItem[];
}

/** An element's top-right corner, on screen. */
function cornerOnScreen(frame: Frame, viewport: Viewport): { x: number; y: number } {
  return worldToScreen(viewport, frameFractionToWorld(frame, 1, 0));
}

/**
 * Where every ritual mark goes on screen for this viewport. Pure — the
 * DOM layer only reconciles nodes to this — so "stamps move with their
 * element" and "orphan pins stay put" are testable without a canvas.
 */
export function layoutRituals(input: RitualLayoutInput): RitualLayout {
  const { viewport, frames } = input;
  const liveIds = new Set(frames.keys());
  const size = stampSize(viewport.zoom);

  const stamps: StampItem[] = [];
  for (const [elementId, list] of stampsByElement(input.stamps, liveIds)) {
    const frame = frames.get(elementId)!;
    for (const { key, stamp } of list) {
      const p = worldToScreen(viewport, frameFractionToWorld(frame, stamp.u, stamp.v));
      stamps.push({
        key,
        stamp,
        glyph: stampGlyph(stamp.kind),
        x: p.x,
        y: p.y,
        size,
        mine: input.myKey !== null && stamp.by === input.myKey,
      });
    }
  }

  // Own votes: a row of dots stepping left from the element's top-right
  // corner, just inside it.
  const voteDots: VoteDotItem[] = [];
  for (const [elementId, n] of input.myVotes) {
    const frame = frames.get(elementId);
    if (!frame) continue;
    const c = cornerOnScreen(frame, viewport);
    for (let i = 0; i < n; i++) {
      voteDots.push({
        key: `${elementId}#${i}`,
        elementId,
        x: c.x - VOTE_DOT / 2 - 4 - i * (VOTE_DOT + 2),
        y: c.y + VOTE_DOT / 2 + 4,
      });
    }
  }

  const results: ResultBadgeItem[] = [];
  for (const [elementId, votes] of input.results) {
    const frame = frames.get(elementId);
    if (!frame || votes <= 0) continue;
    const c = cornerOnScreen(frame, viewport);
    results.push({ key: elementId, elementId, votes, x: c.x, y: c.y });
  }

  const pins: PinItem[] = [];
  for (const thread of input.threads) {
    // Resolved threads leave the canvas, as in docs and sheets; the
    // panel's Resolved tab still lists them.
    if (thread.resolved) continue;
    const at = resolveBoardAnchor(thread.anchor, frames);
    const p = worldToScreen(viewport, at);
    const root = thread.comments[0];
    pins.push({
      key: thread.id,
      threadId: thread.id,
      x: p.x,
      y: p.y,
      label: (root?.author.username ?? "?").slice(0, 1).toUpperCase(),
      count: thread.comments.length,
      active: thread.id === input.activeThreadId,
      orphan: at.orphan,
      pending: false,
    });
  }
  if (input.pending) {
    const at = resolveBoardAnchor(input.pending, frames);
    const p = worldToScreen(viewport, at);
    pins.push({
      key: "__pending__",
      threadId: null,
      x: p.x,
      y: p.y,
      label: "+",
      count: 0,
      active: true,
      orphan: false,
      pending: true,
    });
  }

  return { stamps, voteDots, results, pins };
}

/** The key of one of `myKey`'s stamps under a screen point, topmost first. */
export function hitOwnStamp(
  layout: RitualLayout,
  sx: number,
  sy: number,
): string | null {
  for (let i = layout.stamps.length - 1; i >= 0; i--) {
    const s = layout.stamps[i];
    if (!s.mine) continue;
    if (Math.hypot(sx - s.x, sy - s.y) <= s.size / 2 + 2) return s.key;
  }
  return null;
}

/** Any stamp under a screen point (for the hover card), topmost first. */
export function hitAnyStamp(
  layout: RitualLayout,
  sx: number,
  sy: number,
): StampItem | null {
  for (let i = layout.stamps.length - 1; i >= 0; i--) {
    const s = layout.stamps[i];
    if (Math.hypot(sx - s.x, sy - s.y) <= s.size / 2 + 2) return s;
  }
  return null;
}

/** The element whose own-vote dot is under a screen point. */
export function hitOwnVoteDot(
  layout: RitualLayout,
  sx: number,
  sy: number,
): string | null {
  for (const d of layout.voteDots) {
    if (Math.hypot(sx - d.x, sy - d.y) <= VOTE_DOT / 2 + 2) return d.elementId;
  }
  return null;
}
