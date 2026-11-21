import { useSyncExternalStore } from "react";

/**
 * Media query for "the primary pointer is imprecise" — a finger rather
 * than a mouse or trackpad. This is the axis touch accommodations
 * actually depend on; `useIsMobile()` keys on viewport *width*, which
 * is a different question and gets three common cases wrong: an iPad,
 * an Android tablet, and a phone held in landscape all report a width
 * at or above the 768px breakpoint while still being driven by a
 * fingertip.
 */
const COARSE_POINTER_QUERY = "(pointer: coarse)";

/**
 * Non-React read, for imperative mounts (the slides / board canvas
 * effects build their editor options before any hook value could be
 * threaded in). Falls back to `false` where `matchMedia` is missing —
 * jsdom, and SSR — which keeps the mouse behaviour as the default and
 * makes the touch path strictly additive.
 */
export function isCoarsePointer(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(COARSE_POINTER_QUERY).matches;
}

/**
 * The same question as a hook, for a component that has to *branch* on
 * the pointer rather than resize. Sizes still belong to Tailwind's
 * `pointer-coarse:` variant, which needs no re-render; reach for this only
 * when a touch screen should get different elements — chat messages, whose
 * hover actions become a long-press sheet.
 */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, isCoarsePointer, () => false);
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(COARSE_POINTER_QUERY);
  mql.addEventListener?.("change", onChange);
  return () => mql.removeEventListener?.("change", onChange);
}

/**
 * Hit slack handed to the slides editor on coarse input. 22px expands
 * each 8px visual handle to a ~44px hit diameter — the Apple HIG
 * minimum — without growing the handle itself. Shared so the mobile
 * shell, the desktop slides mount and the board mount cannot drift to
 * three different numbers.
 */
export const TOUCH_HANDLE_TOLERANCE = 22;
