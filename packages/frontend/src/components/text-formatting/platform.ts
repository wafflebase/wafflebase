/**
 * Platform detection helpers shared by the text-formatting toolbar components.
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
