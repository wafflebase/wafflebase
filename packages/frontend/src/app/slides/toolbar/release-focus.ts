/**
 * Shared `onCloseAutoFocus` handler for slides toolbar color palettes.
 *
 * The slides editor's document-level keydown handler filters out events
 * whose `target` is a `<button>` element (see `isEditableTarget()` in
 * `packages/slides/src/view/editor/interactions/keyboard.ts`), so arrow
 * keys never reach the slide canvas while focus sits on the Radix
 * trigger button after a palette closes.
 *
 * Calling `preventDefault()` stops Radix from explicitly focusing the
 * trigger, then blurring the currently focused element returns focus
 * to `document.body`. Arrow / Esc / Delete then route through the
 * slides editor as expected.
 */
export function releaseFocusToBody(e: Event): void {
  e.preventDefault();
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}
