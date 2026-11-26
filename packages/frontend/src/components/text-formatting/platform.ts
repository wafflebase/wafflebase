/**
 * Platform detection: whether this is a Mac (or iOS), where Mod is ⌘. The one
 * sniff for every shortcut label and key binding — the text-formatting
 * toolbars, the shortcuts help dialog, the chat page — so they cannot
 * disagree.
 *
 * Evaluated once at module load time so the values are stable across renders.
 * The `typeof navigator` guard makes them safe in SSR / test environments where
 * `navigator` is undefined.
 */

export const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

/** The platform modifier key label (⌘ on Mac, Ctrl elsewhere). */
export const modKey = isMac ? "⌘" : "Ctrl";
