/**
 * iOS Safari zooms the page when a focused field's font is under 16px, and
 * the viewport no longer pins `maximum-scale` to suppress it (WCAG 1.4.4).
 * On a coarse pointer, raise an engine-built field to 16px; desktop keeps
 * the compact size the panel was laid out with.
 *
 * Not for the cell editor (`CellInput`): its font must match the cell's.
 */
export function fitTouchInputFont(el: HTMLElement): void {
  if (typeof window === 'undefined' || !window.matchMedia) return;
  if (window.matchMedia('(pointer: coarse)').matches) {
    el.style.fontSize = '16px';
  }
}
