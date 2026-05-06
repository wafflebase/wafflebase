import type { Element } from '../../model/element';
import { combinedBoundingBox } from '../../model/frame';

const HANDLE_SIZE = 8;             // px
const ROTATE_HANDLE_OFFSET = 24;   // px above top centre

export interface OverlayOptions {
  /** Host pixels per logical slide pixel. */
  scale: number;
}

/**
 * Render selection handles + the selection frame into `overlay`. The
 * overlay is cleared and rebuilt on every call (cheap with at most
 * ~10 child nodes).
 *
 * For a single selected element with rotation === 0 we draw handles
 * on the element's axis-aligned frame. For rotated single elements
 * and for multi-selection we draw on the combined axis-aligned bbox
 * (resize and rotate of rotated single elements is Phase 3a's
 * deliberate compromise — the user can still grab the rotate handle
 * and the eight bbox handles, but the resize math in T5 will be
 * defined relative to the bbox, not the rotated frame). v2 tightens
 * this to per-element rotated handles.
 */
export function renderOverlay(
  overlay: HTMLDivElement,
  selectedElements: readonly Element[],
  options: OverlayOptions,
): void {
  overlay.innerHTML = '';
  if (selectedElements.length === 0) return;

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
