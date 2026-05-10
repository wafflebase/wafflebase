import type { Element, Frame } from '../../model/element';
import { combinedBoundingBox } from '../../model/frame';
import type { SnapGuide } from './snap';
import { ADJUSTMENT_HANDLES } from '../canvas/shapes/index';
import { defaultAdjustmentsFor } from './interactions/adjustment';

const HANDLE_SIZE = 8;             // px
const ROTATE_HANDLE_OFFSET = 24;   // px above top centre

export interface OverlayOptions {
  /** Host pixels per logical slide pixel. */
  scale: number;
  /** Logical slide width — used to span full-slide guide lines. */
  slideWidth: number;
  /** Logical slide height — used to span full-slide guide lines. */
  slideHeight: number;
  /** Snap guides to render under the selection handles. Empty/omitted = none. */
  guides?: readonly SnapGuide[];
}

/**
 * Render selection handles + the selection frame into `overlay`. The
 * overlay is cleared and rebuilt on every call (cheap with at most
 * ~10 child nodes).
 *
 * For a single selected element with rotation === 0 we draw handles
 * on the element's axis-aligned frame. For a single rotated element we
 * draw handles on the rotated frame's actual corners / edge midpoints
 * + a rotated outline; the resize path uses `resizeFrameWorld` which
 * keeps the anchor handle fixed in world space. For multi-selection
 * we fall back to the combined axis-aligned bbox (multi-element
 * rotated resize is a v2 polish item).
 */
export function renderOverlay(
  overlay: HTMLDivElement,
  selectedElements: readonly Element[],
  options: OverlayOptions,
): void {
  overlay.innerHTML = '';
  if (selectedElements.length === 0) return;

  if (selectedElements.length === 1 && selectedElements[0].frame.rotation !== 0) {
    renderRotatedHandles(overlay, selectedElements[0].frame, options);
    renderAdjustmentHandles(overlay, selectedElements[0], options);
  } else {
    renderAxisAlignedHandles(overlay, selectedElements, options);
  }

  // Snap guide lines (drag-time visual feedback). Rendered last so they
  // sit above the selection frame; pointer-events: none keeps them
  // non-interactive. Apply to both rotated and axis-aligned paths so a
  // single rotated element being dragged also gets visible guides.
  if (options.guides && options.guides.length > 0) {
    for (const g of options.guides) {
      overlay.appendChild(makeGuide(g, options));
    }
  }
}

function renderAxisAlignedHandles(
  overlay: HTMLDivElement,
  selectedElements: readonly Element[],
  options: OverlayOptions,
): void {
  const bbox = combinedBoundingBox(selectedElements.map((e) => e.frame));
  if (!bbox) return;

  const { scale } = options;
  const left = bbox.x * scale;
  const top = bbox.y * scale;
  const width = bbox.w * scale;
  const height = bbox.h * scale;

  // Selection frame outline (no data-handle — purely decorative).
  const frame = document.createElement('div');
  frame.className = 'wfb-slides-selection-frame';
  frame.style.position = 'absolute';
  frame.style.left = `${left}px`;
  frame.style.top = `${top}px`;
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  frame.style.pointerEvents = 'none';
  frame.style.boxSizing = 'border-box';
  frame.style.border = '1px solid #3a7';
  overlay.appendChild(frame);

  const positions: Array<[string, number, number]> = [
    ['nw', left,                top],
    ['n',  left + width / 2,    top],
    ['ne', left + width,        top],
    ['e',  left + width,        top + height / 2],
    ['se', left + width,        top + height],
    ['s',  left + width / 2,    top + height],
    ['sw', left,                top + height],
    ['w',  left,                top + height / 2],
    ['rotate', left + width / 2, top - ROTATE_HANDLE_OFFSET],
  ];
  for (const [kind, cx, cy] of positions) {
    overlay.appendChild(makeHandle(kind, cx, cy));
  }

  if (selectedElements.length === 1) {
    renderAdjustmentHandles(overlay, selectedElements[0], options);
  }
}

function renderRotatedHandles(
  overlay: HTMLDivElement,
  frame: Frame,
  options: OverlayOptions,
): void {
  const { scale } = options;
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const cos = Math.cos(frame.rotation);
  const sin = Math.sin(frame.rotation);

  // Map a local-coords point to world coords (logical slide space).
  const localToWorld = (lx: number, ly: number) => {
    const dx = lx - frame.w / 2;
    const dy = ly - frame.h / 2;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  };

  // Rotated outline — draw an axis-aligned div and CSS-rotate around
  // its centre so the rendered rectangle aligns with the rotated frame.
  const outline = document.createElement('div');
  outline.className = 'wfb-slides-selection-frame';
  outline.style.position = 'absolute';
  outline.style.left = `${frame.x * scale}px`;
  outline.style.top = `${frame.y * scale}px`;
  outline.style.width = `${frame.w * scale}px`;
  outline.style.height = `${frame.h * scale}px`;
  outline.style.transform = `rotate(${frame.rotation}rad)`;
  outline.style.transformOrigin = 'center';
  outline.style.pointerEvents = 'none';
  outline.style.boxSizing = 'border-box';
  outline.style.border = '1px solid #3a7';
  overlay.appendChild(outline);

  // Eight resize handles at the rotated corners / edge midpoints.
  const localPositions: Array<[string, number, number]> = [
    ['nw', 0,           0],
    ['n',  frame.w / 2, 0],
    ['ne', frame.w,     0],
    ['e',  frame.w,     frame.h / 2],
    ['se', frame.w,     frame.h],
    ['s',  frame.w / 2, frame.h],
    ['sw', 0,           frame.h],
    ['w',  0,           frame.h / 2],
  ];
  for (const [kind, lx, ly] of localPositions) {
    const w = localToWorld(lx, ly);
    overlay.appendChild(makeHandle(kind, w.x * scale, w.y * scale));
  }

  // Rotate handle: ROTATE_HANDLE_OFFSET (host px) above the rotated
  // top-centre, in the frame's local "up" direction.
  // Local "up" = R(rot) * (0, -1) = (sin(rot), -cos(rot)).
  const topCenter = localToWorld(frame.w / 2, 0);
  const rotateScreenX = topCenter.x * scale + sin * ROTATE_HANDLE_OFFSET;
  const rotateScreenY = topCenter.y * scale - cos * ROTATE_HANDLE_OFFSET;
  overlay.appendChild(makeHandle('rotate', rotateScreenX, rotateScreenY));
}

function makeHandle(kind: string, cx: number, cy: number): HTMLDivElement {
  const el = document.createElement('div');
  el.dataset.handle = kind;
  el.className = `wfb-slides-handle wfb-slides-handle-${kind}`;
  el.style.position = 'absolute';
  el.style.left = `${cx - HANDLE_SIZE / 2}px`;
  el.style.top = `${cy - HANDLE_SIZE / 2}px`;
  el.style.width = `${HANDLE_SIZE}px`;
  el.style.height = `${HANDLE_SIZE}px`;
  el.style.background = kind === 'rotate' ? '#fff' : '#3a7';
  el.style.border = kind === 'rotate' ? '1px solid #3a7' : '1px solid #fff';
  el.style.borderRadius = kind === 'rotate' ? '50%' : '0';
  el.style.cursor = handleCursor(kind);
  return el;
}

function makeGuide(guide: SnapGuide, options: OverlayOptions): HTMLDivElement {
  const { scale, slideWidth, slideHeight } = options;
  const el = document.createElement('div');
  el.className = 'wfb-slides-snap-guide';
  el.style.position = 'absolute';
  el.style.background = '#e11d48';
  el.style.pointerEvents = 'none';
  if (guide.axis === 'x') {
    el.style.left = `${guide.position * scale}px`;
    el.style.top = '0px';
    el.style.width = '1px';
    el.style.height = `${slideHeight * scale}px`;
  } else {
    el.style.left = '0px';
    el.style.top = `${guide.position * scale}px`;
    el.style.width = `${slideWidth * scale}px`;
    el.style.height = '1px';
  }
  return el;
}

function handleCursor(kind: string): string {
  switch (kind) {
    case 'nw': case 'se': return 'nwse-resize';
    case 'ne': case 'sw': return 'nesw-resize';
    case 'n':  case 's':  return 'ns-resize';
    case 'e':  case 'w':  return 'ew-resize';
    case 'rotate':         return 'crosshair';
    default:               return 'default';
  }
}

const ADJUST_HANDLE_SIZE = 8; // px (post-scale, like resize handles)

function renderAdjustmentHandles(
  overlay: HTMLDivElement,
  el: Element,
  options: OverlayOptions,
): void {
  if (el.type !== 'shape') return;
  const handles = ADJUSTMENT_HANDLES.get(el.data.kind);
  if (!handles || handles.length === 0) return;

  const { scale } = options;
  const { frame } = el;
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const cos = Math.cos(frame.rotation);
  const sin = Math.sin(frame.rotation);
  const localToWorld = (lx: number, ly: number) => {
    const dx = lx - frame.w / 2;
    const dy = ly - frame.h / 2;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  };

  const adjustments =
    el.data.adjustments ?? defaultAdjustmentsFor(el.data.kind);
  handles.forEach((handle, i) => {
    const local = handle.position({ w: frame.w, h: frame.h }, adjustments);
    const world = localToWorld(local.x, local.y);
    overlay.appendChild(
      makeAdjustmentHandle(`adjust-${i}`, world.x * scale, world.y * scale),
    );
  });
}

function makeAdjustmentHandle(kind: string, cx: number, cy: number): HTMLDivElement {
  const el = document.createElement('div');
  el.dataset.handle = kind;
  el.className = `wfb-slides-handle wfb-slides-adjust ${kind}`;
  el.style.position = 'absolute';
  el.style.left = `${cx - ADJUST_HANDLE_SIZE / 2}px`;
  el.style.top = `${cy - ADJUST_HANDLE_SIZE / 2}px`;
  el.style.width = `${ADJUST_HANDLE_SIZE}px`;
  el.style.height = `${ADJUST_HANDLE_SIZE}px`;
  el.style.background = '#FFD500';
  el.style.border = '1px solid #000';
  el.style.transform = 'rotate(45deg)'; // diamond
  el.style.cursor = 'pointer';
  return el;
}
