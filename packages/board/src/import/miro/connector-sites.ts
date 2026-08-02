import type { Frame } from '@wafflebase/slides';
import type { MiroConnectorEndLike, MiroRelativeOffsetLike } from './types';

/**
 * Indices into the board's connection sites, which are the slides package's
 * `FOUR_CARDINAL` (`view/canvas/connection-sites/defaults.ts`) in fixed order:
 *
 *     0: N (0.5, 0)   1: E (1, 0.5)   2: S (0.5, 1)   3: W (0, 0.5)
 *
 * Each site also carries an OUTWARD NORMAL, which the curved/elbow routers bow
 * along. That is why a wrong index is not merely cosmetic: every connector used
 * to be emitted with `siteIndex: 0`, so two shapes sitting side by side were
 * joined by an arrow that left the top of one, arced north, and came down onto
 * the top of the other.
 */
export const SITE_N = 0;
export const SITE_E = 1;
export const SITE_S = 2;
export const SITE_W = 3;

/** Fallback when geometry cannot decide (unknown frames, coincident centres). */
const SITE_FALLBACK = SITE_E;

/**
 * Parse one axis of a Miro `RelativeOffset` ("50%", relative to the item's
 * bounding box with top-left = 0%,0%).
 *
 * Defensive by design — the value is untrusted payload, not a model value:
 * accepts a bare number as well as a string, tolerates a missing `%` and
 * surrounding whitespace, and rejects anything else (junk, empty, `NaN`,
 * `Infinity`) by returning undefined so the caller can fall through to the
 * next rule instead of anchoring at a garbage edge.
 */
function parsePercent(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*%?\s*$/.exec(value);
  if (!match) return undefined;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Nearest cardinal edge for an explicit relative offset, or undefined when the
 * offset carries no usable signal (either axis unparseable, or the offset is
 * exactly the centre — which names no edge, so geometry should decide).
 */
function siteFromPosition(position: MiroRelativeOffsetLike | undefined): number | undefined {
  if (!position) return undefined;
  const x = parsePercent(position.x);
  const y = parsePercent(position.y);
  if (x === undefined || y === undefined) return undefined;
  const dx = x - 50;
  const dy = y - 50;
  if (dx === 0 && dy === 0) return undefined;
  return dominantAxisSite(dx, dy);
}

/** `snapTo` → cardinal. `'auto'` (and anything unrecognised) yields undefined. */
function siteFromSnapTo(snapTo: string | undefined): number | undefined {
  switch (snapTo) {
    case 'top': return SITE_N;
    case 'right': return SITE_E;
    case 'bottom': return SITE_S;
    case 'left': return SITE_W;
    default: return undefined;
  }
}

/**
 * Pick the cardinal that the offset/direction (dx, dy) points at, with the
 * board's screen-style axes: x grows east, **y grows south**. Ties on
 * `|dx| === |dy|` go to the horizontal axis.
 */
function dominantAxisSite(dx: number, dy: number): number {
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? SITE_E : SITE_W;
  return dy > 0 ? SITE_S : SITE_N;
}

/** Centre of a frame (rotation-invariant: Miro rotates about the centre). */
function centreOf(frame: Frame): { x: number; y: number } {
  return { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 };
}

/**
 * Choose the connection site ONE end of a Miro connector should attach to.
 *
 * Precedence, highest first:
 *
 * 1. **Explicit `position`** — a `RelativeOffset` the user dragged the end to
 *    (`{ x: '50%', y: '0%' }` → N). Snapped to the nearest cardinal, because
 *    the board only offers four sites per shape.
 * 2. **`snapTo`** — `top`/`right`/`bottom`/`left` → N/E/S/W. `'auto'` (Miro's
 *    default, and by far the common case) carries no side, so it falls through.
 * 3. **Geometric auto** — the cardinal on THIS element that faces the OTHER
 *    element, from the two frame centres.
 *
 * Each end is resolved independently, so two shapes side by side yield
 * E on the left one and W on the right one — a short, straight-ish link.
 *
 * Pure and total: an unusable input never throws, it falls to the next rule and
 * finally to {@link SITE_FALLBACK}.
 */
export function pickConnectorSite(
  end: MiroConnectorEndLike | undefined,
  self: Frame | undefined,
  other: Frame | undefined,
): number {
  const fromPosition = siteFromPosition(end?.position);
  if (fromPosition !== undefined) return fromPosition;

  const fromSnapTo = siteFromSnapTo(end?.snapTo);
  if (fromSnapTo !== undefined) return fromSnapTo;

  if (!self || !other) return SITE_FALLBACK;
  const a = centreOf(self);
  const b = centreOf(other);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Concentric elements (identical centres) face no direction at all.
  if (dx === 0 && dy === 0) return SITE_FALLBACK;
  return dominantAxisSite(dx, dy);
}
