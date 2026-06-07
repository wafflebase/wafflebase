export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type AdjustmentHandleKind = `adjust-${number}`;
export type ConnectorEndpointHandle = 'start' | 'end';
export type HandleKind =
  | ResizeHandle
  | 'rotate'
  | AdjustmentHandleKind
  | ConnectorEndpointHandle;

/**
 * P2.7 edge-zone tuning: how close to the bbox edge (inside or outside)
 * the cursor flips to a resize affordance, and the rotation cap above
 * which resize cursors would mislead (axis-aligned cursors no longer
 * describe the rotated element's actual resize axes).
 *
 * The "inside or outside" band is per spec — the cursor pre-announces
 * resize even just outside the bbox, even though a click between the
 * corner and mid-edge handle still falls through to the move-drag path
 * (no resize wired there). Treat the cursor as an advisory affordance,
 * not a guaranteed action. Tightening to inside-only would lose the
 * pre-announce feel; widening to ALWAYS resize on edge-zone click
 * would require a new resize-from-edge interaction.
 *
 * See docs/design/slides/slides-hover-and-text-edit-entry.md § P2.7.
 */
export const EDGE_ZONE_THRESHOLD_PX = 4;
export const EDGE_ZONE_MAX_ROTATION_RAD = (5 * Math.PI) / 180;

/**
 * CSS cursor name keyed by resize-handle direction. Single source of
 * truth — both the visible 8-px handle DOM elements (`overlay.ts`
 * `handleCursor`) AND the P2.7 edge-zone hover route their cursor
 * choice through this map so the two affordances cannot drift apart.
 */
export const RESIZE_HANDLE_CURSORS: Readonly<Record<ResizeHandle, string>> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

/** Fold an arbitrary rotation (radians) into `[-π, π]`. */
function normalizeRotation(rotation: number): number {
  const twoPi = 2 * Math.PI;
  const wrapped = ((rotation % twoPi) + twoPi) % twoPi;
  return wrapped > Math.PI ? wrapped - twoPi : wrapped;
}

/**
 * Pure: classify a point against a frame's edge zone. Returns the
 * matching `ResizeHandle` direction when the point is within
 * `threshold` of an edge (or two edges at a corner), or `null` when
 * the point is deeper inside, fully outside, or the frame is rotated
 * past the cap.
 *
 * The point/frame pair must be in the same coordinate space (logical
 * world coords in production). Callers gate by single-selection /
 * handle-priority separately — this helper only does the geometry.
 *
 * Narrow-frame disambiguation: when the frame is so small that the
 * 2×threshold bands overlap (w or h < 2×threshold), both opposing
 * edges would otherwise read as "near" simultaneously and the cascade
 * below would pick a misleading corner. We collapse such ties to the
 * single CLOSEST edge so the cursor describes the nearest resize
 * direction unambiguously.
 *
 * Rotation handling: the rotation cap is checked against a normalised
 * `[-π, π]` angle, so an element rotated past 2π (accumulated via
 * many rotate-drags) doesn't silently disable the affordance.
 */
export function edgeZoneAt(
  px: number,
  py: number,
  frame: { x: number; y: number; w: number; h: number; rotation: number },
  threshold: number = EDGE_ZONE_THRESHOLD_PX,
): ResizeHandle | null {
  if (Math.abs(normalizeRotation(frame.rotation)) > EDGE_ZONE_MAX_ROTATION_RAD) {
    return null;
  }
  const left = frame.x;
  const right = frame.x + frame.w;
  const top = frame.y;
  const bottom = frame.y + frame.h;
  if (px < left - threshold || px > right + threshold) return null;
  if (py < top - threshold || py > bottom + threshold) return null;
  const distLeft = Math.abs(px - left);
  const distRight = Math.abs(px - right);
  const distTop = Math.abs(py - top);
  const distBottom = Math.abs(py - bottom);
  let nearLeft = distLeft <= threshold;
  let nearRight = distRight <= threshold;
  let nearTop = distTop <= threshold;
  let nearBottom = distBottom <= threshold;
  // Both-axes-narrow tiebreak (frame.w < 2t AND frame.h < 2t): every
  // point inside is "near" all four edges; picking a corner direction
  // (e.g. 'se') from the cascade below would mislead the user about
  // which axis they're actually closest to. Collapse to the single
  // strictly-closest edge so the resize cursor matches the dominant
  // direction. Single-axis-narrow case still falls through to the
  // per-axis tiebreak below.
  const narrowW = frame.w < 2 * threshold;
  const narrowH = frame.h < 2 * threshold;
  if (narrowW && narrowH) {
    const candidates: Array<[ResizeHandle, number]> = [];
    if (nearLeft) candidates.push(['w', distLeft]);
    if (nearRight) candidates.push(['e', distRight]);
    if (nearTop) candidates.push(['n', distTop]);
    if (nearBottom) candidates.push(['s', distBottom]);
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a[1] - b[1]);
    return candidates[0][0];
  }
  // Single-axis tiebreak: opposing edges along one axis both "near"
  // collapses to the strictly closer one.
  if (nearLeft && nearRight) {
    if (distLeft < distRight) nearRight = false;
    else nearLeft = false;
  }
  if (nearTop && nearBottom) {
    if (distTop < distBottom) nearBottom = false;
    else nearTop = false;
  }
  if (!nearLeft && !nearRight && !nearTop && !nearBottom) return null;
  if (nearTop && nearLeft) return 'nw';
  if (nearTop && nearRight) return 'ne';
  if (nearBottom && nearLeft) return 'sw';
  if (nearBottom && nearRight) return 'se';
  if (nearTop) return 'n';
  if (nearBottom) return 's';
  if (nearLeft) return 'w';
  return 'e';
}

/** CSS cursor name for an edge-zone direction. */
export function edgeZoneCursor(zone: ResizeHandle): string {
  return RESIZE_HANDLE_CURSORS[zone];
}

const RESIZE_HANDLES: readonly string[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rotate'];
const CONNECTOR_ENDPOINT_HANDLES: readonly string[] = ['start', 'end'];

function isHandleKind(value: string | undefined): value is HandleKind {
  return (
    value !== undefined &&
    (RESIZE_HANDLES.includes(value) ||
      CONNECTOR_ENDPOINT_HANDLES.includes(value) ||
      /^adjust-\d+$/.test(value))
  );
}

/**
 * Hit-test a point against the handle elements inside an overlay.
 * Returns the handle kind (`nw`, `e`, `rotate`, ...) or `null`.
 *
 * Handle elements MUST carry `data-handle="<kind>"`. Other children
 * of the overlay are ignored.
 *
 * `tolerance` expands each handle's hit rectangle by that many pixels
 * on every side without changing the visual handle size. Default 0
 * (no expansion) keeps desktop precision; the mobile shell passes a
 * touch-sized tolerance so fingertips reliably land on the 8px
 * visual handles.
 */
export function handleHitTest(
  overlay: HTMLDivElement,
  x: number,
  y: number,
  tolerance = 0,
): HandleKind | null {
  // Among all handles whose expanded rect contains (x, y), pick the
  // one whose center is closest to the point. This matters on touch:
  // a 22px tolerance around the eight resize handles + rotate on a
  // small selection makes their hit rectangles overlap, and a
  // first-match-wins strategy picks by DOM order rather than user
  // intent. Closest-center keeps tolerance helpful in isolation and
  // deterministic where it overlaps.
  const handles = overlay.querySelectorAll<HTMLElement>('[data-handle]');
  let bestKind: HandleKind | null = null;
  let bestDistSq = Infinity;
  for (let i = handles.length - 1; i >= 0; i--) {
    const el = handles[i];
    const left = parseFloat(el.style.left);
    const top = parseFloat(el.style.top);
    const width = parseFloat(el.style.width);
    const height = parseFloat(el.style.height);
    if (
      x < left - tolerance ||
      x > left + width + tolerance ||
      y < top - tolerance ||
      y > top + height + tolerance
    ) {
      continue;
    }
    const kind = el.dataset.handle;
    if (!isHandleKind(kind)) continue;
    const cx = left + width / 2;
    const cy = top + height / 2;
    const dx = x - cx;
    const dy = y - cy;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestKind = kind;
    }
  }
  return bestKind;
}
