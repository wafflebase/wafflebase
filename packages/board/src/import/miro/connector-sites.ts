import {
  connectionSitesForKind,
  siteWorldPos,
  DIR_E,
  DIR_N,
  DIR_S,
  DIR_W,
  type Frame,
  type ShapeKind,
} from '@wafflebase/slides';
import type { MiroConnectorEndLike, MiroRelativeOffsetLike } from './types';

/**
 * An endpoint is chosen as a DIRECTION — an outward-normal angle in the slides
 * connection-site convention (x east, y south, radians) — and only then
 * resolved to an index.
 *
 * The index a direction lands on depends on the target's `ShapeKind`: the
 * default four-cardinal list is `[N, E, S, W]`, but `ellipse` has eight sites
 * where index 1 is NW, and `parallelogram` shifts its N and S anchors along
 * the skew. Resolving against the real list is what keeps this correct as the
 * slides package adds overrides.
 *
 * The outward normal matters as much as the position: the curved and elbow
 * routers bow along it, which is why a wrong site is never merely cosmetic.
 * Every connector was once emitted with `siteIndex: 0`, so two shapes side by
 * side were joined by an arrow that left the top of one, arced north, and came
 * down onto the top of the other.
 *
 * The constants come from the slides model rather than being redeclared here,
 * so a direction can never disagree with the angles the sites are stored with.
 */
export { DIR_E, DIR_N, DIR_S, DIR_W };

/** Fallback when geometry cannot decide (unknown frames, coincident centres). */
const DIR_FALLBACK = DIR_E;

/**
 * The index of the site on `kind` that faces `direction`.
 *
 * Resolved by nearest outward normal rather than by position, because that is
 * what the routers steer by, and it degrades sensibly for a shape whose site
 * list has no exact match. Angles are compared on the circle, so `-π` and `π`
 * are the same direction rather than the furthest apart.
 */
export function siteIndexFor(kind: ShapeKind | undefined, direction: number): number {
  const sites = connectionSitesForKind(kind);
  let best = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < sites.length; i++) {
    const raw = Math.abs(sites[i].angle - direction) % (Math.PI * 2);
    const delta = Math.min(raw, Math.PI * 2 - raw);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = i;
    }
  }
  return best;
}

/**
 * Where on a frame a given connection site sits, in board coordinates.
 *
 * This is the point a connector actually leaves from or arrives at, so
 * anything positioning itself along a connector must use it rather than the
 * frame centre — a connector runs edge to edge, and a centre chord diverges
 * from the drawn line as soon as the two shapes differ in size.
 *
 * It delegates to the renderer's own `siteWorldPos`, which is what makes it
 * agree with the drawn line on the two things a local reimplementation gets
 * wrong: per-kind site geometry, and the frame's rotation and flips.
 */
export function siteAnchor(
  frame: Frame,
  siteIndex: number,
  kind: ShapeKind | undefined,
): { x: number; y: number } {
  const sites = connectionSitesForKind(kind);
  const site = sites[siteIndex] ?? sites[0];
  const { x, y } = siteWorldPos({ frame }, site);
  return { x, y };
}

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
export function parsePercent(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*%?\s*$/.exec(value);
  if (!match) return undefined;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * The direction an explicit relative offset points, or undefined when the
 * offset carries no usable signal (either axis unparseable, or the offset is
 * exactly the centre — which names no direction, so geometry should decide).
 *
 * The TRUE angle, not a cardinal. Miro's offset is a continuous point the user
 * dragged the end to, and `siteIndexFor` snaps it to whatever the target
 * actually offers — four sides on a rect, but eight on an ellipse, whose
 * diagonals no cardinal could ever reach. Collapsing to a cardinal here would
 * throw that away before the shape got a say.
 */
function directionFromPosition(position: MiroRelativeOffsetLike | undefined): number | undefined {
  if (!position) return undefined;
  const x = parsePercent(position.x);
  const y = parsePercent(position.y);
  if (x === undefined || y === undefined) return undefined;
  const dx = x - 50;
  const dy = y - 50;
  if (dx === 0 && dy === 0) return undefined;
  return Math.atan2(dy, dx);
}

/** `snapTo` → cardinal. `'auto'` (and anything unrecognised) yields undefined. */
function directionFromSnapTo(snapTo: string | undefined): number | undefined {
  switch (snapTo) {
    case 'top': return DIR_N;
    case 'right': return DIR_E;
    case 'bottom': return DIR_S;
    case 'left': return DIR_W;
    default: return undefined;
  }
}

/**
 * Pick the cardinal that the offset/direction (dx, dy) points at, with the
 * board's screen-style axes: x grows east, **y grows south**. Ties on
 * `|dx| === |dy|` go to the horizontal axis.
 */
function dominantAxisDirection(dx: number, dy: number): number {
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? DIR_E : DIR_W;
  return dy > 0 ? DIR_S : DIR_N;
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
 *    Miro's offset is continuous and a board shape offers discrete sites.
 * 2. **`snapTo`** — `top`/`right`/`bottom`/`left` → N/E/S/W. `'auto'` (Miro's
 *    default, and by far the common case) carries no side, so it falls through.
 * 3. **Geometric auto** — the cardinal on THIS element that faces the OTHER
 *    element, from the two frame centres.
 *
 * Each end is resolved independently, so two shapes side by side yield
 * E on the left one and W on the right one — a short, straight-ish link.
 *
 * The chosen direction is resolved to an INDEX against the target's own site
 * list, which is why `kind` is required: the four-cardinal default is
 * `[N, E, S, W]`, but an `ellipse` — what every Miro `circle` becomes, 722 of
 * them on the reference board — has eight sites whose index 1 is NW. Returning
 * a bare cardinal index attached those connectors to the wrong side of the
 * shape and bowed them along the wrong outward normal.
 *
 * Pure and total: an unusable input never throws, it falls to the next rule and
 * finally to {@link DIR_FALLBACK}.
 */
export function pickConnectorSite(
  end: MiroConnectorEndLike | undefined,
  self: Frame | undefined,
  other: Frame | undefined,
  kind: ShapeKind | undefined,
): number {
  return siteIndexFor(kind, pickConnectorDirection(end, self, other));
}

/** The cardinal an end should face, before it is resolved to a site index. */
function pickConnectorDirection(
  end: MiroConnectorEndLike | undefined,
  self: Frame | undefined,
  other: Frame | undefined,
): number {
  const fromPosition = directionFromPosition(end?.position);
  if (fromPosition !== undefined) return fromPosition;

  const fromSnapTo = directionFromSnapTo(end?.snapTo);
  if (fromSnapTo !== undefined) return fromSnapTo;

  if (!self || !other) return DIR_FALLBACK;
  const a = centreOf(self);
  const b = centreOf(other);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Concentric elements (identical centres) face no direction at all.
  if (dx === 0 && dy === 0) return DIR_FALLBACK;
  return dominantAxisDirection(dx, dy);
}
