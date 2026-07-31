/**
 * True when `target` is a regular editable DOM control — an
 * `<input>`/`<textarea>`/`<select>` or a `contenteditable` region — or
 * a focused interactive widget (a `<button>` or `role="button"`
 * element) — i.e. somewhere a document-level keyboard shortcut must
 * not intercept a plain keystroke like Space. Used by `BoardView`'s
 * pan-mode Space shortcut so typing a space in, e.g., the SiteHeader
 * rename input or the Share dialog isn't swallowed, and so Space on a
 * focused `BoardToolbar` toggle still activates the button instead of
 * entering pan mode (a `preventDefault()`'d Space would otherwise
 * suppress the button's own space-activates-click behavior). Mirrors
 * the identically-named guard's button/role handling in
 * `packages/slides/src/view/editor/interactions/keyboard.ts`.
 *
 * Pulled into its own module (rather than living inline in
 * `board-view.tsx`) so it can be unit-tested directly — `BoardView`'s
 * mount effect imperatively builds a canvas + Yorkie doc, too heavy to
 * mount in a unit test just to exercise this pure predicate — and so
 * `board-view.tsx` keeps exporting only the `BoardView` component
 * (react-refresh/only-export-components).
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((target as HTMLElement).isContentEditable) return true;
  if (tag === "BUTTON") return true;
  return target.getAttribute("role") === "button";
}
