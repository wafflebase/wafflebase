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

const MENU_ITEM_SELECTOR =
  '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';

/**
 * The enabled items that belong to `menu` itself, in DOM order — not the
 * items of a submenu nested inside it, which walk on their own.
 */
export function menuItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(
    menu.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR),
  ).filter(
    (el) =>
      el.closest('[role="menu"]') === menu &&
      !el.matches(':disabled, [aria-disabled="true"]'),
  );
}

export interface MenuKeyboardOptions {
  /** Escape (and, for a submenu, ArrowLeft): close and restore focus. */
  onClose(): void;
  /**
   * ArrowRight on a focused item. Return `true` when the item opened a
   * submenu (and so handled the key); leave unset for a flat menu.
   */
  onOpenSubmenu?(item: HTMLElement): boolean;
  /** Whether ArrowLeft closes this menu — true for a submenu. */
  isSubmenu?: boolean;
}

/**
 * Keyboard model for the hand-built canvas context menus (the docs body and
 * table menus), per the WAI-ARIA menu pattern: Up / Down step between
 * items (wrapping), Home / End jump, Enter / Space activate, a printable
 * character jumps to the next item starting with it, ArrowRight opens a
 * submenu and ArrowLeft leaves one, Escape closes. Tab is swallowed so
 * focus cannot walk out of a menu that would then stay open behind it.
 *
 * Wire it to the menu element's `onKeyDown`. Focus itself is the roving
 * cursor — items carry `tabIndex={-1}` and are moved with `focus()` — and
 * handled keys stop here, so the editor's own shortcuts never see them.
 * These menus are not Radix because Radix `ContextMenu` swallows the
 * canvas pointer events they are opened from.
 */
export function handleMenuKeyDown(
  e: React.KeyboardEvent<HTMLElement>,
  options: MenuKeyboardOptions,
): void {
  if (e.nativeEvent.isComposing) return;
  const menu = e.currentTarget;
  const items = menuItems(menu);
  const active = document.activeElement as HTMLElement | null;
  const current = active ? items.indexOf(active) : -1;
  const focusAt = (index: number) => {
    if (items.length === 0) return;
    const n = items.length;
    items[((index % n) + n) % n].focus();
  };

  let handled = true;
  switch (e.key) {
    case "ArrowDown":
      focusAt(current < 0 ? 0 : current + 1);
      break;
    case "ArrowUp":
      focusAt(current < 0 ? items.length - 1 : current - 1);
      break;
    case "Home":
      focusAt(0);
      break;
    case "End":
      focusAt(items.length - 1);
      break;
    case "Enter":
    case " ": {
      if (current < 0) break;
      const item = items[current];
      // A submenu trigger opens its submenu with focus inside it, the
      // same as ArrowRight; a click from the mouse only toggles it.
      if (item.hasAttribute("aria-haspopup") && options.onOpenSubmenu?.(item)) {
        break;
      }
      item.click();
      break;
    }
    case "ArrowRight":
      handled =
        current >= 0 && (options.onOpenSubmenu?.(items[current]) ?? false);
      break;
    case "ArrowLeft":
      if (options.isSubmenu) options.onClose();
      else handled = false;
      break;
    case "Escape":
      options.onClose();
      break;
    case "Tab":
      break;
    default: {
      handled = false;
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) break;
      const ch = e.key.toLowerCase();
      for (let step = 1; step <= items.length; step++) {
        const item = items[(current + step) % items.length];
        if (item.textContent?.trim().toLowerCase().startsWith(ch)) {
          item.focus();
          handled = true;
          break;
        }
      }
    }
  }
  if (handled) e.preventDefault();
  // A submenu keeps every key to itself: one it ignored must not bubble
  // to the parent menu and, say, typeahead focus out from under it.
  if (handled || options.isSubmenu) e.stopPropagation();
}

/**
 * Pointer half of the same model: the highlight follows focus, and the
 * pointer moves focus, so hovering and arrowing paint one highlight and
 * two rows can never be lit at once. Wire to the menu's `onPointerMove`.
 * Moving off every item (onto a label, a separator, or out of the menu —
 * wire `onPointerLeave` here too) parks focus on the menu itself.
 */
export function handleMenuPointerMove(
  e: React.PointerEvent<HTMLElement>,
): void {
  const menu = e.currentTarget;
  const target = e.type === "pointerleave" ? null : (e.target as Element);
  const item = target?.closest<HTMLElement>(MENU_ITEM_SELECTOR) ?? null;
  if (item && menuItems(menu).includes(item)) {
    if (document.activeElement !== item) item.focus({ preventScroll: true });
    return;
  }
  const active = document.activeElement;
  if (
    active instanceof HTMLElement &&
    active !== menu &&
    menu.contains(active) &&
    active.closest('[role="menu"]') === menu
  ) {
    menu.focus({ preventScroll: true });
  }
}
