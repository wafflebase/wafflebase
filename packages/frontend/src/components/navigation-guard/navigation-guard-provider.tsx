import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  UNSAFE_NavigationContext as NavigationContext,
  useLocation,
  type Navigator,
  type To,
} from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  GuardRegistryContext,
  type GuardRegistry,
  type NavigationGuard,
  type NavigationPrompt,
} from "./use-navigation-guard";

/**
 * The path `to` resolves to, without its query or hash.
 *
 * Routed through the navigator's own `createHref` so that the destination and
 * the current location are resolved the same way — basename included — and can
 * be compared as plain strings.
 */
function pathOf(navigator: Navigator, to: To): string {
  return navigator.createHref(to).split("#")[0].split("?")[0];
}

/**
 * Lets a component hold back in-app navigation until the user confirms.
 *
 * `useBlocker` would be the supported way to do this and is out of reach: it
 * requires a data router (`createBrowserRouter`), and the app mounts
 * `<BrowserRouter>`. So this wraps the seam one level down —
 * `UNSAFE_NavigationContext`'s `navigator`, through which react-router routes
 * every `<Link>` click and every `useNavigate()` call. Browser back/forward is
 * *not* covered: it arrives on the history listener, not here.
 *
 * Mount inside `<Router>`, above the routes that want guarding.
 *
 * Design: docs/design/sync-status.md
 */
export function NavigationGuardProvider({
  children,
}: {
  children: ReactNode;
}) {
  const context = useContext(NavigationContext);

  // Where the user is now, read at fire time rather than closed over, so the
  // patched navigator does not have to be rebuilt on every route change.
  const location = useLocation();
  const locationRef = useRef(location);
  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  // Held in a ref so that registering or dropping a guard never rebuilds the
  // patched navigator, whose identity every consumer of the context depends on.
  const guardsRef = useRef(new Set<NavigationGuard>());

  const [prompt, setPrompt] = useState<NavigationPrompt | null>(null);
  // The navigation that was held back, replayed verbatim if the user leaves.
  const pendingRef = useRef<(() => void) | null>(null);

  const register = useCallback((guard: NavigationGuard) => {
    guardsRef.current.add(guard);
    return () => {
      guardsRef.current.delete(guard);
    };
  }, []);

  const registry = useMemo<GuardRegistry>(() => ({ register }), [register]);

  const value = useMemo(() => {
    const base = context.navigator;

    /**
     * Whether `to` leaves the page the user is on. A guard that blocked every
     * `navigator.push` would also block a document rewriting its own query
     * string, which is not leaving anything. An empty pathname — a `to` that
     * carries only a search or a hash — means "here".
     */
    const leaving = (to: To) => {
      const next = pathOf(base, to);
      return next !== "" && next !== pathOf(base, locationRef.current);
    };

    const attempt = (leavesPage: boolean, run: () => void) => {
      if (leavesPage) {
        for (const guard of guardsRef.current) {
          const held = guard();
          if (held) {
            pendingRef.current = run;
            setPrompt(held);
            return;
          }
        }
      }
      run();
    };

    // Rebuilt member by member rather than spread: react-router reads exactly
    // these five off the navigator, and the history object behind them carries
    // `action`/`location` as getters that a spread would freeze.
    //
    // The methods are also called unbound — `(replace ? navigator.replace :
    // navigator.push)(to, …)` — so none of them may depend on `this`.
    const navigator: Navigator = {
      createHref: (to) => base.createHref(to),
      encodeLocation: base.encodeLocation
        ? (to) => base.encodeLocation!(to)
        : undefined,
      // A relative `go` cannot be resolved to a path, and every one of them is
      // a deliberate move away from here.
      go: (delta) => attempt(delta !== 0, () => base.go(delta)),
      push: (to, state, opts) =>
        attempt(leaving(to), () => base.push(to, state, opts)),
      replace: (to, state, opts) =>
        attempt(leaving(to), () => base.replace(to, state, opts)),
    };

    return { ...context, navigator };
  }, [context]);

  const stay = useCallback(() => {
    pendingRef.current = null;
    setPrompt(null);
  }, []);

  const leave = useCallback(() => {
    const run = pendingRef.current;
    pendingRef.current = null;
    setPrompt(null);
    run?.();
  }, []);

  return (
    <NavigationContext.Provider value={value}>
      <GuardRegistryContext.Provider value={registry}>
        {children}
        <AlertDialog
          open={prompt !== null}
          onOpenChange={(open) => {
            if (!open) stay();
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{prompt?.title}</AlertDialogTitle>
              <AlertDialogDescription>
                {prompt?.description}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              {/* Staying is the safe answer, so it is the one that needs no
                  thought: it is also what dismissing the dialog does. */}
              <AlertDialogCancel onClick={stay}>Stay</AlertDialogCancel>
              <AlertDialogAction onClick={leave}>
                {prompt?.confirmLabel}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </GuardRegistryContext.Provider>
    </NavigationContext.Provider>
  );
}
