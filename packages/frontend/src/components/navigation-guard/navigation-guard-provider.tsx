import {
  useCallback,
  useContext,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  GuardRegistryContext,
  type GuardRegistry,
  type NavigationGuard,
  type NavigationPrompt,
} from "./use-navigation-guard";

/**
 * The path `to` resolves to, without its query or hash.
 *
 * `createHref` does *not* prepend the basename — it is `createPath(to)` for
 * both the browser and memory histories — but `useNavigate` has already joined
 * the basename into the pathname it hands to `push`. So this is comparable
 * against the current location only after the same join; see `basenamed`.
 */
function pathOf(navigator: Navigator, to: To): string {
  return navigator.createHref(to).split("#")[0].split("?")[0];
}

/**
 * The current pathname with the basename joined back on, which `useLocation`
 * strips. Mirrors react-router's own `joinPaths`, so `/` collapses away and a
 * real basename does not double its separator.
 */
function basenamed(basename: string, pathname: string): string {
  return [basename, pathname].join("/").replace(/\/\/+/g, "/");
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
  //
  // Mirrored during render, not in an effect: this provider sits above
  // `<Routes>`, and React runs a child's effects before its parent's — so an
  // effect here would leave a child that navigates on mount comparing against
  // the location it has already left.
  const location = useLocation();
  const locationRef = useRef(location);
  locationRef.current = location;

  // Held in a ref so that registering or dropping a guard never rebuilds the
  // patched navigator, whose identity every consumer of the context depends on.
  const guardsRef = useRef(new Set<NavigationGuard>());

  const [prompt, setPrompt] = useState<NavigationPrompt | null>(null);
  // The navigation that was held back, replayed verbatim if the user leaves.
  const pendingRef = useRef<(() => void) | null>(null);
  // The path the open prompt was raised on, which is how a location moving
  // under the dialog is noticed without watching `location` from an effect.
  const promptPathRef = useRef<string | null>(null);

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
     * push would also block a document rewriting its own query string, which
     * is not leaving anything. An empty pathname — a `to` that carries only a
     * search or a hash — means "here".
     */
    const leaving = (to: To) => {
      const next = pathOf(base, to);
      if (next === "") return false;
      const { pathname } = locationRef.current;
      return next !== basenamed(context.basename, pathname);
    };

    const push: Navigator["push"] = (to, state, opts) => {
      const run = () => base.push(to, state, opts);
      if (leaving(to)) {
        for (const guard of guardsRef.current) {
          const held = guard();
          if (!held) continue;
          // Keep the navigation the dialog is describing. A second one
          // arriving while it is open would otherwise send the user somewhere
          // they never clicked the moment they answer.
          if (!pendingRef.current) {
            pendingRef.current = run;
            promptPathRef.current = locationRef.current.pathname;
            setPrompt(held);
          }
          return;
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
      // Only `push` is guarded, and that is the whole distinction: a push is
      // the user going somewhere. `replace` is how this app corrects the URL
      // on its own behalf — an editor sending you back to the workspace when
      // its document 404s, `PrivateRoute`/`PublicRoute` sending you to /login
      // or / — and those must not be refusable. There is nothing to "stay" on,
      // and because the effect that issued the redirect does not run again, a
      // Stay would swallow it for good and strand the user in a dead editor.
      // That makes it an invariant rather than an observation: an app-issued
      // redirect has to *be* a replace, `<Navigate replace>` included, since
      // `<Navigate>` defaults to a push. `go` is the programmatic back button,
      // which this guard does not cover either way.
      go: (delta) => base.go(delta),
      push,
      replace: (to, state, opts) => base.replace(to, state, opts),
    };

    return { ...context, navigator };
  }, [context]);

  const stay = useCallback(() => {
    pendingRef.current = null;
    promptPathRef.current = null;
    setPrompt(null);
  }, []);

  // This provider sits above `<Routes>` and so survives the route change a
  // dialog was asking about. If the app navigates while a prompt is open — an
  // unguarded `replace` redirect, or the guarded document flushing and then
  // releasing a later click — the dialog is left describing a page the user
  // has already left, and answering it would replay a stale destination. So
  // the prompt is dropped when the location moves out from under it.
  //
  // Decided during render rather than from a `useEffect` keyed on `location`,
  // for the same ordering reason `locationRef` is mirrored during render:
  // React runs a child's effects before its parent's, so such an effect also
  // fires on the commit where a child effect *raised* the prompt — wiping it
  // before the user ever sees it and dropping that navigation in silence.
  // Comparing the pathname rather than the whole location also keeps a prompt
  // alive through the same-page query rewrites `leaving` already exempts,
  // which the user has likewise not answered yet.
  if (prompt !== null && promptPathRef.current !== location.pathname) {
    pendingRef.current = null;
    promptPathRef.current = null;
    setPrompt(null);
  }

  const leave = useCallback(() => {
    const run = pendingRef.current;
    pendingRef.current = null;
    promptPathRef.current = null;
    setPrompt(null);
    run?.();
  }, []);

  return (
    <NavigationContext.Provider value={value}>
      <GuardRegistryContext.Provider value={registry}>
        {children}
        {/* `Dialog`, not `AlertDialog`, and the reason is the bundle rather
            than the semantics. This provider is imported eagerly by `App.tsx`,
            and `@radix-ui/react-alert-dialog` is deliberately split out of the
            eager `vendor-ui` into `vendor-ui-history` (vite.config.ts) because
            the version-history panel is its only consumer and that panel is
            lazy — importing it here would put those ~14 kB back on every
            route's first paint. `@radix-ui/react-dialog` is already in the
            eager chunk for the shell's sheet and dialogs, so this costs
            nothing. Lazy-loading the dialog instead was the other option and
            is the wrong one: it is needed exactly when the network is down. */}
        <Dialog
          open={prompt !== null}
          onOpenChange={(open) => {
            if (!open) stay();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{prompt?.title}</DialogTitle>
              <DialogDescription>{prompt?.description}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              {/* Staying is the safe answer, so it is what every way of
                  dismissing this dialog — Escape, the close button, a click
                  outside — also does. */}
              <Button variant="outline" onClick={stay}>
                Stay
              </Button>
              <Button variant="destructive" onClick={leave}>
                {prompt?.confirmLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </GuardRegistryContext.Provider>
    </NavigationContext.Provider>
  );
}
