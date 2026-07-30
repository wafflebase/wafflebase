/**
 * True when `target` is a regular editable DOM control — an
 * `<input>`/`<textarea>`/`<select>` or a `contenteditable` region —
 * i.e. somewhere a document-level keyboard shortcut must not intercept
 * a plain keystroke like Space. Used by `BoardView`'s pan-mode Space
 * shortcut so typing a space in, e.g., the SiteHeader rename input or
 * the Share dialog isn't swallowed.
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
  return Boolean((target as HTMLElement).isContentEditable);
}
