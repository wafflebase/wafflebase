import { useCallback, useRef } from "react";

/**
 * Shared focus-restoration helpers for controlled color-palette dropdowns.
 *
 * The color palettes in sheets / docs / slides toolbars render swatches as
 * plain `<button>`s — not Radix `DropdownMenuItem`s — so they wrap the
 * picker in a controlled `DropdownMenu` and call `setOpen(false)` after
 * applying the color. The two open questions are:
 *
 *   1) After close, where should focus go?
 *      - docs: the hidden textarea (`editor.focus()`) so arrow / typing
 *        works against the caret.
 *      - slides: anywhere but the trigger `<button>`, because the slides
 *        editor's document-level keydown handler ignores events whose
 *        target is a `<button>` (see `isEditableTarget()` in
 *        `packages/slides/src/view/editor/interactions/keyboard.ts`).
 *
 *   2) Should we force that restoration even when the user dismissed the
 *      palette by clicking outside or pressing Esc? No — that would steal
 *      focus from the user's actual click target (another toolbar button,
 *      a side panel input, the canvas). We only want to take over focus
 *      when the close was caused by a swatch click.
 *
 * This module solves both: `useMenuCloseHandlers` tracks "did the user
 * click a swatch?" via a ref; only that case triggers the supplied
 * `onSwatchClose` callback. Outside-click and Esc fall through to Radix's
 * default focus-to-trigger, then the natural click target / body keep
 * focus.
 */
export interface MenuCloseHandlers {
  /** Call inside the swatch click handler, before `setOpen(false)`. */
  markSwatchClicked(): void;
  /** Wire to `<DropdownMenuContent onCloseAutoFocus={...}>`. */
  onCloseAutoFocus(e: Event): void;
}

export function useMenuCloseHandlers(
  onSwatchClose: () => void,
): MenuCloseHandlers {
  const swatchClickedRef = useRef(false);
  // Latest-callback ref so consumers can pass a fresh closure each render
  // without invalidating the stable `onCloseAutoFocus` reference (which
  // would force Radix to detach/reattach the listener).
  const onSwatchCloseRef = useRef(onSwatchClose);
  onSwatchCloseRef.current = onSwatchClose;

  const markSwatchClicked = useCallback(() => {
    swatchClickedRef.current = true;
  }, []);

  const onCloseAutoFocus = useCallback((e: Event) => {
    if (!swatchClickedRef.current) return;
    swatchClickedRef.current = false;
    e.preventDefault();
    onSwatchCloseRef.current();
  }, []);

  return { markSwatchClicked, onCloseAutoFocus };
}

/**
 * Drop focus to `document.body` by blurring the currently focused element.
 * Used by slides so arrow keys can reach the document-level keydown
 * handler (a focused `<button>` would block them — see the module-level
 * comment above).
 */
export function releaseFocusToBody(): void {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}
