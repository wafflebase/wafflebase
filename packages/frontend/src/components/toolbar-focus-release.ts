import { useEffect } from "react";
import { releaseFocusToBody } from "./menu-focus";

/**
 * Toolbar → canvas focus release for the Canvas-rendered editors.
 *
 * The slides editor reads shortcuts from a document-level `keydown`
 * listener and skips every rule whose `e.target` is "not the slide canvas"
 * — which includes a focused `<button>` (see `isEditableTarget()` in
 * `packages/slides/src/view/editor/interactions/keyboard.ts`). That gate is
 * deliberate: without it, Enter on a focused toolbar button would enter
 * text-edit mode instead of activating the button. The problem is that a
 * plain `<button>` keeps focus after a click, and Radix hands focus back to
 * the *trigger* when a dropdown closes — so once any toolbar control has
 * been touched, the gate stays engaged and arrow keys / Delete / the
 * z-order shortcuts silently stop reaching the canvas (issue #882).
 *
 * This hook closes that gap by dropping focus back to the body once a
 * pointer-driven toolbar interaction is finished. Opt a toolbar in by
 * setting the `CANVAS_TOOLBAR_ATTR` attribute — written literally as
 * `data-canvas-toolbar=""`, since a computed key does not type-check as a
 * JSX spread — on its root element.
 *
 * Text-edit keepalive controls (`data-text-edit-keepalive`) are exempt:
 * there the canvas is deliberately *not* the keyboard's owner, because an
 * in-place text box is still mounted behind the toolbar.
 */

/** Marks a toolbar root whose focus should return to the canvas. */
export const CANVAS_TOOLBAR_ATTR = "data-canvas-toolbar";

const TOOLBAR_SELECTOR = `[${CANVAS_TOOLBAR_ATTR}]`;

/**
 * Controls that deliberately hold focus while a text-box edit session
 * stays mounted. `packages/docs/src/view/text-box-editor.ts` skips its
 * blur-commit when focus moves into one of these, so the session is still
 * alive and the canvas must NOT get the keyboard back — releasing here
 * would re-arm Delete / type-to-edit against the element being edited.
 * It is also what lets the shared pickers keep their documented
 * "dismiss restores focus to the trigger" contract.
 */
const TEXT_EDIT_KEEPALIVE_SELECTOR = "[data-text-edit-keepalive]";

/**
 * Portalled surfaces a toolbar control can open. A pointer-down inside one
 * of these still counts as "the user is working the toolbar", so selecting
 * a menu item releases focus the same way clicking the trigger does.
 */
const POPUP_SELECTOR =
  '[role="menu"], [role="dialog"], [role="listbox"], [data-radix-popper-content-wrapper]';

/**
 * True while `el` is a trigger whose popup is open. Radix sets both
 * attributes on an open trigger; the `data-state` comparison is against
 * `"open"` exactly, because `Toggle` uses the same attribute for
 * `"on"`/`"off"` and a pressed toggle must still be releasable.
 */
function hasOpenPopup(el: Element): boolean {
  return (
    el.getAttribute("aria-expanded") === "true" ||
    el.getAttribute("data-state") === "open"
  );
}

/**
 * Only button-like toolbar controls are released. Text inputs inside a
 * toolbar (zoom, font size) legitimately own the keyboard while focused,
 * and text-edit keepalive controls own it on behalf of a live text box.
 */
function isReleasable(el: Element | null): boolean {
  return (
    el instanceof HTMLElement &&
    el.closest(TOOLBAR_SELECTOR) !== null &&
    (el.tagName === "BUTTON" || el.getAttribute("role") === "button") &&
    el.closest(TEXT_EDIT_KEEPALIVE_SELECTOR) === null &&
    !hasOpenPopup(el)
  );
}

function isPointerDrivenTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest(TOOLBAR_SELECTOR) !== null ||
    target.closest(POPUP_SELECTOR) !== null
  );
}

export function useCanvasFocusRelease(): void {
  useEffect(() => {
    // Whether the focus we are about to see arrived as part of a
    // pointer-driven toolbar interaction. A `Tab` press clears it so a
    // keyboard user who deliberately tabs into the toolbar — or who
    // tabbed to a trigger and then dismissed its menu — keeps focus
    // where they put it.
    let pointerDriven = false;
    let pending: ReturnType<typeof setTimeout> | undefined;

    const onPointerDown = (e: Event) => {
      pointerDriven = isPointerDrivenTarget(e.target);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab") pointerDriven = false;
    };

    const onFocusIn = (e: FocusEvent) => {
      if (!pointerDriven) return;
      if (
        !(e.target instanceof Element) ||
        e.target.closest(TOOLBAR_SELECTOR) === null
      ) {
        return;
      }
      // Defer one task and re-read `document.activeElement`: a menu
      // trigger hands focus to its portalled content, and text-edit
      // controls end with `editor.focus()`. Either way focus has left the
      // button by the time this runs, and the release no-ops.
      clearTimeout(pending);
      pending = setTimeout(() => {
        if (isReleasable(document.activeElement)) releaseFocusToBody();
      }, 0);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    return () => {
      clearTimeout(pending);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
    };
  }, []);
}
