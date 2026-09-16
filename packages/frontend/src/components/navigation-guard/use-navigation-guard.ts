import { createContext, useContext, useEffect, useRef } from "react";

/** What to say when a navigation is held back. */
export interface NavigationPrompt {
  title: string;
  description: string;
  /** Label for the button that leaves anyway. Cancelling is always "Stay". */
  confirmLabel: string;
}

/**
 * Asked at the instant a navigation is attempted. Returns the prompt to show,
 * or `null` to let it through.
 */
export type NavigationGuard = () => NavigationPrompt | null;

export interface GuardRegistry {
  /** Returns the function that unregisters. */
  register: (guard: NavigationGuard) => () => void;
}

/**
 * Registering outside a `NavigationGuardProvider` is a no-op rather than an
 * error. `SiteHeader` and the editors it heads are rendered under a bare
 * `MemoryRouter` by a good number of component tests, and an editor that
 * refused to mount without the app shell around it would be a worse trade than
 * an unguarded one there.
 */
export const GuardRegistryContext = createContext<GuardRegistry>({
  register: () => () => {},
});

/**
 * Holds back in-app navigation while `active`, asking `guard` at the moment one
 * is attempted.
 *
 * The split is deliberate and matches the unload guard in `SyncStatusChip`:
 * `active` is the smoothed, rendered state — cheap to watch, and safe to be
 * wrong about, because registering a guard costs nothing. `guard` is the live
 * read, and it is the only thing that decides. A modal in front of every
 * sidebar click for the two seconds a chip holds `Saving…` after the last
 * keystroke would teach people to dismiss it unread.
 *
 * Design: docs/design/sync-status.md
 */
export function useNavigationGuard(active: boolean, guard: NavigationGuard) {
  const { register } = useContext(GuardRegistryContext);

  const guardRef = useRef(guard);
  useEffect(() => {
    guardRef.current = guard;
  }, [guard]);

  useEffect(() => {
    if (!active) return;
    return register(() => guardRef.current());
  }, [active, register]);
}
