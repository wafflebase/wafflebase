export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type AdjustmentHandleKind = `adjust-${number}`;
export type ConnectorEndpointHandle = 'start' | 'end';
export type HandleKind =
  | ResizeHandle
  | 'rotate'
  | AdjustmentHandleKind
  | ConnectorEndpointHandle;

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
