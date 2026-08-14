/**
 * The frame's network boundary.
 *
 * WHY THE FIXTURE LAYER IS `fetch` AND NOT `queryFn`.
 *
 * The obvious design is a real query client whose DEFAULT `queryFn` resolves from
 * a fixture map keyed by query key. It cannot work, and the reason is structural
 * rather than incidental: a client-level default `queryFn` is only consulted when
 * the caller does not supply one, and real pages supply one per query. Keying
 * fixtures on the query key resolves nothing for every such page — measured across
 * four of wafflebase's own routes, all four of which pass their own `queryFn`.
 *
 * Substituting at the `fetch` layer is also the strictly better answer, because it
 * keeps MORE of the product in the code path: the app's own auth wrapper with its
 * real 401 → refresh → retry branch, its error shaping, and each page's own loading
 * / empty / error rendering all still run. Only the bytes differ, which is the
 * editor's whole premise.
 *
 * WHY IT THROWS LOUDLY ON A MISS.
 *
 * A scene that quietly reaches the real backend does not fail visibly — it fails as
 * a 401, and a typical auth wrapper answers a 401 by logging out and assigning
 * `window.location.href`. Inside a frame that NAVIGATES THE FRAME OFF the scene
 * document. The frame does not render an error state; it silently becomes a
 * different page, which reads as "the scene is broken" and costs an afternoon. So an
 * unmocked URL is a hard, named failure reported to the host with the URL in it.
 *
 * The guard must be installed BEFORE the scene module is imported. Real API modules
 * compute base URLs at module scope and real pages fire queries on mount, so a guard
 * installed after the import has already lost the race.
 */

import { BASE } from '../base.ts';

/** A fixture answer: JSON body, or a full `Response` for the odd status test. */
export type FixtureValue = unknown | Response;

/**
 * URL → fixture. The key is matched against the request URL's `pathname` (+
 * `search` when the fixture key contains a `?`), so fixtures do not have to know the
 * API origin — which the consumer points at a deliberately unreachable sentinel
 * rather than at their real backend.
 */
export type FixtureTable = Record<string, FixtureValue>;

export interface FetchGuardOptions {
  fixtures: FixtureTable;
  /** Called with the offending URL when nothing matches. */
  onMiss: (url: string, method: string) => void;
}

/** `http://scene.invalid/api/documents?x=1` → `/api/documents?x=1`. */
function keyOf(input: RequestInfo | URL): { path: string; full: string } {
  const raw =
    typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  try {
    const u = new URL(raw, window.location.origin);
    return { path: u.pathname, full: `${u.pathname}${u.search}` };
  } catch {
    return { path: raw, full: raw };
  }
}

let installed = false;

/**
 * Replace `window.fetch` for the lifetime of the frame. Idempotent, because a
 * fast-refresh update re-runs module side effects and wrapping a wrapper would
 * stack a new guard on every keystroke.
 */
export function installFetchGuard(opts: FetchGuardOptions): void {
  if (installed) {
    activeFixtures = opts.fixtures;
    activeOnMiss = opts.onMiss;
    return;
  }
  installed = true;
  activeFixtures = opts.fixtures;
  activeOnMiss = opts.onMiss;

  const real = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const { path, full } = keyOf(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();

    // Vite's own dev traffic (HMR ping, module fetches) and the editor's own mount
    // are ours and must pass through untouched, or the frame cannot hot-update
    // itself and cannot reach the bridge.
    //
    // `BASE`, not the prototype's literal `/__design-sdk/`: that namespace does not
    // exist in the shipped plugin, so every request to the editor's own routes fell
    // through to the miss path below and THREW. Deriving it means the passthrough
    // cannot drift from the mount again.
    if (
      path.startsWith('/@') ||
      path.startsWith(`${BASE}/`) ||
      path.startsWith('/node_modules/')
    ) {
      return real(input as RequestInfo, init);
    }

    const hit = full in activeFixtures ? activeFixtures[full] : activeFixtures[path];
    if (hit !== undefined) {
      if (hit instanceof Response) return hit.clone();
      return new Response(JSON.stringify(hit), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    activeOnMiss(full, method);
    throw new Error(
      `[design-editor] unmocked request: ${method} ${full}\n` +
        `Add a fixture for it in the scene's fixture table, or the scene is not ` +
        `rendering the data a user would see. Requests are never allowed to leave ` +
        `the frame: a real 401 makes an auth wrapper navigate the frame off the ` +
        `scene document, which looks identical to a broken scene.`,
    );
  };
}

let activeFixtures: FixtureTable = {};
let activeOnMiss: (url: string, method: string) => void = () => {};

/** Swap the fixture table without re-wrapping `fetch` (scene switches). */
export function setFixtures(fixtures: FixtureTable): void {
  activeFixtures = fixtures;
}

/**
 * The Mock Data toggle's transform: every array anywhere in a fixture value
 * becomes `[]`, recursively. Generic rather than a second fixture file per
 * scene — a fixture already IS a plain JSON value (a bare array, or an object with
 * array fields), so emptying every array reachable from it produces the correct
 * "zero rows" shape for any scene without maintaining a matching empty variant by
 * hand. `Response` fixtures (the odd-status tests) pass through untouched — there is
 * no "empty" reading of a 404.
 */
export function emptyFixtureTable(table: FixtureTable): FixtureTable {
  const emptyDeep = (v: unknown): unknown => {
    if (Array.isArray(v)) return [];
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, emptyDeep(val)]));
    return v;
  };
  return Object.fromEntries(
    Object.entries(table).map(([url, value]) => [url, value instanceof Response ? value : emptyDeep(value)]),
  );
}
