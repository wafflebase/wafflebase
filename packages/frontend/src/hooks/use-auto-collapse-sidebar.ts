import * as React from "react";

const DEFAULT_MIN_WIDTH = 1280;

function subscribe(query: string) {
  return (onChange: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const mql = window.matchMedia(query);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  };
}

function matches(query: string): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(query).matches;
}

/**
 * Controlled `open` / `onOpenChange` for a `SidebarProvider` that collapses
 * the app sidebar while the viewport is narrower than `minWidth`. Editors
 * whose canvas sits between side panels (slides: thumbnail rail + Format
 * panel) need that width more than they need navigation.
 *
 * The collapse is derived, never written: it does not go through the
 * provider's `setOpen`, so neither the user's preference nor the
 * `sidebar_state` cookie changes. A manual toggle while narrow is a
 * temporary override that lasts until the viewport is wide again; at that
 * point the preference applies, and the next narrow entry collapses afresh.
 */
export function useAutoCollapseSidebar(minWidth = DEFAULT_MIN_WIDTH) {
  const query = `(max-width: ${minWidth - 1}px)`;
  // Synchronous on first render, so a narrow window never paints the
  // sidebar open for a frame before collapsing it.
  const narrow = React.useSyncExternalStore(
    React.useMemo(() => subscribe(query), [query]),
    () => matches(query),
    () => false,
  );

  const [preference, setPreference] = React.useState(true);
  const [narrowOpen, setNarrowOpen] = React.useState(false);
  const [wasNarrow, setWasNarrow] = React.useState(narrow);
  if (narrow !== wasNarrow) {
    setWasNarrow(narrow);
    if (narrow) setNarrowOpen(false);
  }

  const onOpenChange = React.useCallback(
    (open: boolean) => (narrow ? setNarrowOpen(open) : setPreference(open)),
    [narrow],
  );

  return { open: narrow ? narrowOpen : preference, onOpenChange };
}
