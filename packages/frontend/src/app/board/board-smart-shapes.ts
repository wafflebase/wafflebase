import type { ElementInit, Stroke } from "@wafflebase/slides";

/**
 * Smart shapes: a hand-drawn box becomes a rectangle, a loop an ellipse,
 * a straight stroke a line, a stroke ending in a flick an arrow (FigJam's
 * "shape recognition"). Opt-in from the marker popover.
 *
 * Plain geometry, no model: every decision below is a ratio against the
 * stroke's own size, so the same gesture is recognised at any zoom.
 *
 * - **Closure**: the gap between the ends is small against the stroke's
 *   bounding box. Only a closed stroke can be a rectangle or an ellipse.
 * - **Corners**: the stroke is resampled to evenly spaced points and a
 *   corner is a sharp turn (summed over a short window, so a rounded
 *   hand-drawn corner still counts). A box has four, an ellipse none.
 * - **Fit error**: the mean distance from each point to the candidate
 *   outline, relative to the shape's size. A wobbly circle fits an
 *   ellipse well and a rectangle badly, and a box the other way round.
 *
 * Anything ambiguous returns `null`, and the stroke stays a stroke: a
 * wrong guess costs the user an undo, a missed one costs nothing.
 */

export type Pt = { x: number; y: number };

export type SmartShape =
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "ellipse"; x: number; y: number; w: number; h: number }
  | { kind: "line"; start: Pt; end: Pt }
  | { kind: "arrow"; start: Pt; end: Pt };

/** Below this size (world px, longest side) nothing is recognised: a dot, a tick. */
const MIN_SHAPE_SIZE = 24;

const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

function pathLength(points: readonly Pt[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += dist(points[i - 1], points[i]);
  return len;
}

function bounds(points: readonly Pt[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** `n` points evenly spaced along the polyline. */
export function resample(points: readonly Pt[], n: number): Pt[] {
  if (points.length < 2) return points.slice();
  const total = pathLength(points);
  if (total === 0) return [points[0]];
  const step = total / (n - 1);
  const out: Pt[] = [points[0]];
  let acc = 0;
  let prev = points[0];
  for (let i = 1; i < points.length; i++) {
    const cur = points[i];
    let d = dist(prev, cur);
    while (acc + d >= step && out.length < n - 1) {
      const t = (step - acc) / d;
      const q = { x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) };
      out.push(q);
      prev = q;
      d = dist(prev, cur);
      acc = 0;
    }
    acc += d;
    prev = cur;
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Largest distance from any point to the chord between the ends, over the chord length. */
function straightness(points: readonly Pt[]): number {
  const a = points[0];
  const b = points[points.length - 1];
  const len = dist(a, b);
  if (len === 0) return Infinity;
  let max = 0;
  for (const p of points) {
    const d = Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len;
    max = Math.max(max, d);
  }
  return max / len;
}

/** Chord span, in resampled points, for {@link countCorners}. */
const SPAN = 2;

/**
 * Number of sharp turns along a closed, resampled stroke. The turn at a
 * sample is the angle between the chord arriving from {@link SPAN}
 * samples back and the chord leaving to SPAN samples ahead: chords, not
 * single steps, so hand jitter averages out while a corner still reads
 * as ~90°. A corner is a local peak of that angle above 60°. Wrap-around
 * is included, so a box drawn from a corner still has four.
 */
export function countCorners(ring: readonly Pt[]): number {
  const n = ring.length;
  if (n < 8) return 0;
  const at = (i: number) => ring[((i % n) + n) % n];
  const turn: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = at(i - SPAN);
    const c = at(i);
    const q = at(i + SPAN);
    let d = Math.atan2(q.y - c.y, q.x - c.x) - Math.atan2(c.y - p.y, c.x - p.x);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    turn.push(Math.abs(d));
  }
  const threshold = (60 * Math.PI) / 180;
  let corners = 0;
  for (let i = 0; i < n; i++) {
    if (turn[i] < threshold) continue;
    let peak = true;
    for (let k = -SPAN; k <= SPAN && peak; k++) {
      if (k === 0) continue;
      const j = (i + k + n) % n;
      // Ties go to the earlier sample, so a flat-topped peak counts once.
      if (turn[j] > turn[i] || (turn[j] === turn[i] && k < 0)) peak = false;
    }
    if (peak) corners++;
  }
  return corners;
}

/** Mean distance from the points to the bbox outline, over the shorter side. */
function rectError(points: readonly Pt[], b: { x: number; y: number; w: number; h: number }): number {
  let sum = 0;
  for (const p of points) {
    const d = Math.min(
      Math.abs(p.x - b.x),
      Math.abs(p.x - (b.x + b.w)),
      Math.abs(p.y - b.y),
      Math.abs(p.y - (b.y + b.h)),
    );
    sum += d;
  }
  return sum / points.length / Math.min(b.w, b.h);
}

/** Mean radial error against the inscribed ellipse, in units of its radius. */
function ellipseError(points: readonly Pt[], b: { x: number; y: number; w: number; h: number }): number {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const rx = b.w / 2;
  const ry = b.h / 2;
  let sum = 0;
  for (const p of points) {
    const r = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
    sum += Math.abs(r - 1);
  }
  return sum / points.length;
}

/** Thresholds, tuned on the synthetic strokes in the tests. */
const LINE_STRAIGHTNESS = 0.06;
const CLOSURE = 0.2;
const RECT_ERROR = 0.06;
const ELLIPSE_ERROR = 0.08;
const MIN_ASPECT = 0.08;

/**
 * Recognise a straight line, or a line whose end turns back in a flick
 * (an arrowhead barb, one-sided or a V).
 */
function recognizeOpen(points: readonly Pt[], size: number): SmartShape | null {
  const start = points[0];
  if (straightness(points) < LINE_STRAIGHTNESS) {
    const end = points[points.length - 1];
    if (dist(start, end) < size * 0.9) return null;
    return { kind: "line", start, end };
  }
  // The tip is the point farthest from the start; the shaft runs to it.
  let tipIndex = 0;
  let far = 0;
  points.forEach((p, i) => {
    const d = dist(start, p);
    if (d > far) {
      far = d;
      tipIndex = i;
    }
  });
  const tip = points[tipIndex];
  const shaft = points.slice(0, tipIndex + 1);
  const tail = points.slice(tipIndex);
  if (shaft.length < 3 || tail.length < 2) return null;
  if (straightness(shaft) >= LINE_STRAIGHTNESS) return null;
  const shaftLen = dist(start, tip);
  const tailLen = pathLength(tail);
  if (tailLen < shaftLen * 0.06 || tailLen > shaftLen * 0.6) return null;
  // Every barb point sits behind the tip and close to the shaft's line:
  // inside a 15°–75° cone opening backwards from the tip.
  const ux = (tip.x - start.x) / shaftLen;
  const uy = (tip.y - start.y) / shaftLen;
  let barb = false;
  for (const p of tail.slice(1)) {
    // A V's stroke passes back through the tip between its two barbs.
    if (dist(p, tip) <= shaftLen * 0.04) continue;
    const back = (tip.x - p.x) * ux + (tip.y - p.y) * uy;
    const side = Math.abs((p.x - tip.x) * uy - (p.y - tip.y) * ux);
    if (back <= 0) return null;
    const angle = Math.atan2(side, back);
    if (angle > (75 * Math.PI) / 180) return null;
    if (angle > (15 * Math.PI) / 180) barb = true;
  }
  if (!barb) return null;
  return { kind: "arrow", start, end: tip };
}

/** What `points` (world) look like, or `null` when unsure. */
export function recognizeStroke(points: readonly Pt[]): SmartShape | null {
  if (points.length < 2) return null;
  const b = bounds(points);
  const size = Math.max(b.w, b.h);
  if (size < MIN_SHAPE_SIZE) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const closed = dist(first, last) < CLOSURE * size && pathLength(points) > 2.2 * size;
  if (!closed) return recognizeOpen(points, size);
  if (Math.min(b.w, b.h) < MIN_ASPECT * size) return null;
  const ring = resample(points, 64);
  // Drop the closing sample so the ring does not repeat its start.
  if (ring.length > 2 && dist(ring[0], ring[ring.length - 1]) < size * 0.05) ring.pop();
  const corners = countCorners(ring);
  const rErr = rectError(ring, b);
  const eErr = ellipseError(ring, b);
  if (corners >= 3 && corners <= 5 && rErr < RECT_ERROR && rErr * 1.2 < eErr) {
    return { kind: "rect", ...b };
  }
  if (corners <= 2 && eErr < ELLIPSE_ERROR && eErr < rErr * 1.5) {
    return { kind: "ellipse", ...b };
  }
  return null;
}

/**
 * The elements a recognised shape becomes, drawn with the marker's own
 * stroke and no fill, so the result looks like what was drawn, only
 * cleaner.
 */
export function smartShapeInits(shape: SmartShape, stroke: Stroke): ElementInit[] {
  const lineStroke = { color: stroke.color, width: stroke.width };
  if (shape.kind === "rect" || shape.kind === "ellipse") {
    return [
      {
        type: "shape",
        frame: { x: shape.x, y: shape.y, w: shape.w, h: shape.h, rotation: 0 },
        data: { kind: shape.kind, stroke: lineStroke },
      },
    ];
  }
  return [
    {
      type: "connector",
      routing: "straight",
      start: { kind: "free", x: shape.start.x, y: shape.start.y },
      end: { kind: "free", x: shape.end.x, y: shape.end.y },
      arrowheads: shape.kind === "arrow" ? { end: { kind: "triangle", size: "md" } } : {},
      frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
      stroke: lineStroke,
    },
  ];
}
