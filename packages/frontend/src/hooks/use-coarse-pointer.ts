import * as React from "react";

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
 * React hook form of {@link isCoarsePointer}, kept live so a device
 * that switches primary pointer mid-session (a tablet with a keyboard
 * folio attached or detached, a Surface flipping modes) re-renders the
 * components whose sizing depends on it.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = React.useState(isCoarsePointer);

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(COARSE_POINTER_QUERY);
    const onChange = () => setCoarse(mql.matches);
    // Re-read on mount: the initial `useState` ran during render, which
    // on a hydrated page can precede the media query settling.
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return coarse;
}

/**
 * Hit slack handed to the slides editor on coarse input. 22px expands
 * each 8px visual handle to a ~44px hit diameter — the Apple HIG
 * minimum — without growing the handle itself. Shared so the mobile
 * shell, the desktop slides mount and the board mount cannot drift to
 * three different numbers.
 */
export const TOUCH_HANDLE_TOLERANCE = 22;
