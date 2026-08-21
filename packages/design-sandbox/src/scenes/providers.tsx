/**
 * providers.tsx — the context a scene needs, composed by name from
 * `scenes.config.json`'s `mocks`.
 *
 * THE RULE: real providers, substituted data. Never a hand-written stub.
 *
 * A fake `useQuery` or a fake `Link` diverges from the app's real loading,
 * empty and error branches, and the sandbox's entire premise is that what you
 * see is what the committed code does. With `MemoryRouter`, a real
 * `QueryClient` and (CP4) the real `Mem*Store`s, every code path inside the
 * scene is the production path and only the bytes flowing in differ. React
 * Router ships `MemoryRouter` for exactly this.
 *
 * NESTING ORDER MIRRORS `packages/frontend/src/App.tsx` — Theme > Tooltip >
 * Query > Router. Not cosmetic: a provider that reads another's context would
 * behave differently under a different order, and the point is to reproduce the
 * app rather than something adjacent to it.
 *
 * `auth` NAMES NO PROVIDER. The frontend has no auth context — `createContext`
 * appears only in `theme-provider.tsx`, `ui/chart.tsx` and `ui/sidebar.tsx`.
 * The identity a scene sees comes from `/auth/me`, so `mocks: ["auth"]` means
 * "install the auth fixtures" and is handled in `fixtures/`, not here. The key
 * is kept because it still documents the scene's dependency surface.
 *
 * NO `<Toaster/>`. Several api modules call `toast()` on failure; without a
 * Toaster those are inert, which is what we want. A toast is not part of the
 * layout under edit, and rendering one would put a floating element into every
 * visual diff.
 *
 * THIS MODULE IS LOADED FRAME-QUALIFIED (`?wbFrame=…`), together with the
 * scene, and that is load-bearing. Loaded unqualified while the scene is
 * qualified, `@/components/theme-provider` resolves to two different module
 * instances and therefore two different `ThemeProviderContext` objects:
 * `useContext` would return the default, and the Settings scene's switch would
 * read as always-light with a no-op `setTheme`. Silent, and expensive to find.
 */
/*
 * THE HOST'S STYLESHEET, supplied by the host.
 *
 * `scene-entry.tsx` deliberately imports none: §6 says the frame keeps using the CONSUMER's
 * CSS, because dressing a scene in the editor's own stylesheet is measuring the instrument.
 * That is right, and it left the other half undone — nothing on this side supplied one, so
 * every scene rendered wafflebase's components with no Tailwind and no tokens, which reads
 * as a broken theme rather than a missing import.
 *
 * It belongs HERE rather than in the manifest: this module is already the consumer's
 * scene-side entry point, and it is loaded frame-qualified with the scene, so the CSS
 * arrives on the same graph the components do.
 */
import '@/index.css';
import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ThemeProvider } from '@/components/theme-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import Layout from '@/app/Layout';
import { scenes as SCENE_CONFIGS } from 'virtual:wb-scenes';

/**
 * Catches navigation to anywhere other than the scene's own route.
 *
 * The MemoryRouter here declares exactly ONE page route — the scene under
 * edit — nested under the real `Layout`. Click a DIFFERENT sidebar item (Data
 * Sources while viewing Documents) with picking OFF and the router has
 * nowhere to send it: before this, that was a silent 404 into an empty
 * `<Outlet/>`, indistinguishable from a broken scene (`shell.ts`'s note about
 * the Analytics nav entry).
 *
 * This wildcard sibling route renders instead, and its only job is to tell the
 * HOST what path the user actually wanted — `SandboxLayout` matches it against
 * `scenes.config.json` and switches `sceneId`, which reloads the iframe onto
 * the RIGHT scene's own module. That is a real frame reload, not an in-place
 * render, because each frame is one Vite entry keyed to one patched module
 * (`SceneHost`'s "one frame, one file" invariant) — there is no way to keep
 * this frame alive and have it become a different scene's editable module.
 */
function RouteEscapeNotifier() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: 'wb:route-change', path: location.pathname },
      window.location.origin,
    );
  }, [location.pathname]);

  // `virtual:wb-scenes` is the same manifest the HOST matches against — see
  // `SandboxLayout#onRouteChange` — so the frame can tell these two cases
  // apart itself instead of leaving every unmatched path stuck on a
  // "Switching scene…" message that never resolves. A dynamic-id link (a
  // document row, `/s/doc-q4-revenue`) is the common way to land here: no
  // manifest scene names that exact path, only its `/s/fixture` stand-in.
  const known = SCENE_CONFIGS.some((s) => s.route === location.pathname);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center text-xs text-muted-foreground">
      {known ? (
        'Switching scene…'
      ) : (
        <>
          <span>This route isn&apos;t one of the Sandbox&apos;s scenes.</span>
          <span className="font-code text-[10px] opacity-70">{location.pathname}</span>
        </>
      )}
    </div>
  );
}

export interface SceneProvidersProps {
  mocks: string[];
  route?: string;
  /**
   * The react-router PATTERN to register, when it differs from the literal
   * `route` above. `route` is a real, navigable fixture path (`/w/ws-fixture`)
   * — the exact string the `MemoryRouter` is pointed at AND, until this field
   * existed, the exact string registered as the `<Route path>` pattern too.
   * That second use is what broke every workspace-scoped scene silently:
   * `workspace-documents.tsx` (and `-datasources`/`-analytics`/`-settings`)
   * call `useParams<{ workspaceId }>()`, which needs a `:workspaceId` SEGMENT
   * in the matched route pattern to produce anything — a literal path with no
   * colon resolves `useParams()` to `{}`, so `workspaceId` is `undefined` and
   * every one of those pages' `enabled: !!workspaceId` queries never ran.  No
   * error, no loading state stuck open — just a silently empty list, which is
   * why it read as "the mock data disappeared" rather than as a visible bug.
   */
  routePattern?: string;
  /** `"app"` mounts the scene inside the real `app/Layout.tsx`. */
  shell?: 'app';
  theme: 'light' | 'dark';
  children: ReactNode;
}

/**
 * Nothing may refetch, retry or expire.
 *
 * A retry turns one missing fixture into four identical kill-switch throws, and
 * an expiry turns a static scene into one that flickers through its loading
 * state while you are trying to judge spacing. `staleTime: Infinity` also means
 * a component-level `refetchInterval` (documents' 5 s "currently editing" poll)
 * resolves from fixtures instantly and, thanks to react-query's structural
 * sharing, hands back the same object — so it costs no re-render.
 */
const makeClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        gcTime: Infinity,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: { retry: false },
    },
  });

export function SceneProviders({ mocks, route, routePattern, shell, theme, children }: SceneProvidersProps) {
  const [queryClient] = useState(makeClient);
  // `shell` needs a router to nest into, so it implies one rather than failing
  // with react-router's "useNavigate() may only be used in the context of a
  // <Router>" from a tree that visibly has a Layout in it.
  const has = (m: string) => mocks.includes(m) || (m === 'router' && shell === 'app');

  let tree = children;

  if (has('router')) {
    const path = route ?? '/';
    // The MemoryRouter's actual location stays the literal `path` — only the
    // PATTERN registered below can differ. See `routePattern`'s own comment.
    const pattern = routePattern ?? path;
    // WHY THE SHELL IS A NESTED ROUTE AND NOT `<Layout>{children}</Layout>`.
    //
    // `Layout` renders `<Outlet/>`, not `props.children`. Wrapping directly
    // would mount the sidebar and the header and then render NOTHING where the
    // page belongs — a convincing-looking shell around an empty content area,
    // which is worse than no shell because it looks deliberate. Declaring the
    // real parent/child route pair is also what `App.tsx` does, so
    // `useLocation`, `matchPath` (the header title) and the sidebar's active
    // state all resolve exactly as they will in production.
    tree =
      shell === 'app' ? (
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<Layout />}>
              <Route path={pattern} element={tree} />
              {/* Anywhere else the shell's own nav can lead — see
                  `RouteEscapeNotifier`. More specific routes above always win,
                  so this never shadows the scene's own path. */}
              <Route path="*" element={<RouteEscapeNotifier />} />
            </Route>
          </Routes>
        </MemoryRouter>
      ) : (
        // `initialEntries` is the scene's own route, so `useParams` /
        // `useLocation` see what the real route would give them — but only if
        // a `<Route>` is actually registered for `pattern`. Without one,
        // `useParams()` has no matched route to read from and resolves to
        // `{}`, silently turning `:id` into `undefined` (the CP4 canvas
        // scenes' `/api/documents/undefined` failure).
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={pattern} element={tree} />
          </Routes>
        </MemoryRouter>
      );
  }
  if (has('query')) {
    tree = <QueryClientProvider client={queryClient}>{tree}</QueryClientProvider>;
  }
  if (has('tooltip')) {
    tree = <TooltipProvider delayDuration={0}>{tree}</TooltipProvider>;
  }
  if (has('theme')) {
    // The app's OWN ThemeProvider, unmodified. It already knows it is in a
    // frame: it reads `?theme=` from the URL, skips `localStorage` when
    // `window.self !== window.top`, and applies `postMessage({type:
    // 'theme-change'})` from the same origin. The host sends exactly that
    // message — the identical protocol the homepage's live-demo iframe already
    // uses (`app/home/demo-section.tsx#postTheme`). Nothing new was invented
    // for the sandbox, and nothing in the app was changed for it.
    tree = <ThemeProvider defaultTheme={theme}>{tree}</ThemeProvider>;
  }

  return <>{tree}</>;
}

export default SceneProviders;
