export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type HandleKind = ResizeHandle | 'rotate';

const RESIZE_HANDLES: readonly HandleKind[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rotate'];

function isHandleKind(value: string | undefined): value is HandleKind {
  return value !== undefined && (RESIZE_HANDLES as readonly string[]).includes(value);
}

/**
 * Hit-test a point against the handle elements inside an overlay.
 * Returns the handle kind (`nw`, `e`, `rotate`, ...) or `null`.
 *
 * Handle elements MUST carry `data-handle="<kind>"`. Other children
 * of the overlay are ignored.
 */
export function handleHitTest(
  overlay: HTMLDivElement,
  x: number,
  y: number,
): HandleKind | null {
  // Find the highest z-order handle element that contains (x, y).
  const handles = overlay.querySelectorAll<HTMLElement>('[data-handle]');
  // Iterate in reverse so the most recently appended handle wins on overlap.
  for (let i = handles.length - 1; i >= 0; i--) {
    const el = handles[i];
    const left = parseFloat(el.style.left);
    const top = parseFloat(el.style.top);
    const width = parseFloat(el.style.width);
    const height = parseFloat(el.style.height);
    if (x >= left && x <= left + width && y >= top && y <= top + height) {
      const kind = el.dataset.handle;
      if (isHandleKind(kind)) return kind;
    }
  }
  return null;
}
