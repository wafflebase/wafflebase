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

/**
 * Vite's error overlay opens a file by `fetch`ing this from the frame:
 *
 *     // vite/dist/client/client.mjs
 *     fetch(new URL(`${base}__open-in-editor?file=${encodeURIComponent(file)}`, …))
 *
 * It is not a module request, so it matches none of the prefixes below and fell to
 * the miss path — and `onMiss`'s contract is a hard `wb:error` with `kind: 'fetch'`
 * naming the URL. Clicking a stack frame in the overlay therefore reported the
 * designer's own scene as having made an unmocked request.
 *
 * Matched on the last segment, not by a whole-path equality: the client prefixes the
 * consumer's `base`, which the frame cannot know. Not by a bare `/__` prefix either
 * — that would pass a consumer route like `/__admin` straight out of the frame,
 * which is what this guard exists to prevent.
 *
 * There is deliberately no `/__vite_ping` here. Vite 2 served one over HTTP; 6.4.3
 * does not — `waitForSuccessfulPing` opens a WebSocket (`new WebSocket(socketUrl,
 * 'vite-ping')`) and the string appears nowhere in its dist. Listing it would be a
 * passthrough for a path only a consumer could own.
 */
const VITE_DEV_PATH_RE = /(?:^|\/)__open-in-editor$/;

/**
 * The bug reporter's two dev-server endpoints
 * (`packages/debug-report/src/plugin/report-endpoint.ts`).
 *
 * The reporter runs INSIDE the frame — it has to, because only there can it name
 * an element in the scene — so its handover and its drafting call are `fetch`es
 * from this document, and this guard refused them as unmocked. What the reporter
 * saw was a scene fetch error; what it means is that the one request the frame
 * makes on the REPORTER's behalf rather than the SCENE's was being judged by the
 * scene's rules.
 *
 * A regex rather than importing `REPORT_ENDPOINT` / `DRAFT_ENDPOINT`: this module
 * is in every frame's graph, and importing the package here would make it a hard
 * dependency of frames that never asked for a reporter — the thing
 * `scenes/debug-report.tsx`'s lazy gate exists to prevent.
 * `test/scenes/debug-report.test.tsx` pins this pattern against those constants,
 * so the duplication cannot drift silently.
 *
 * Matched exactly, not as a `__wb_` prefix, for the reason the Vite rule above
 * gives: a loose prefix is a passthrough for paths only a consumer could own.
 */
const DEBUG_REPORT_PATH_RE = /(?:^|\/)__wb_debug_(?:report|draft)$/;

/** A fixture answer: JSON body, or a full `Response` for the odd status test. */
export type FixtureValue = unknown | Response;

/**
 * URL → fixture. The key is matched against the request URL's `pathname` (+
 * `search` when the fixture key contains a `?`), so fixtures do not have to know the
 * API origin — which the consumer points at a deliberately unreachable sentinel
 * rather than at their real backend.
 *
 * A key may be prefixed with a method — `'POST /api/documents'` — and must be for
 * anything other than GET or HEAD. A bare path answers reads only.
 */
export type FixtureTable = Record<string, FixtureValue>;

export interface FetchGuardOptions {
  fixtures: FixtureTable;
  /** Called with the offending URL when nothing matches. */
  onMiss: (url: string, method: string) => void;
}

/**
 * `http://scene.invalid/api/documents?x=1` → `/api/documents?x=1`.
 *
 * `sameOrigin` travels with the path because every passthrough below matches on
 * the PATH, and stripping the origin is what makes that unsafe on its own:
 * `https://external.example/__wb_debug_report` reduces to the reporter's own
 * endpoint path and left the frame — as would `//external.example/@vite/client`
 * or any absolute URL wearing one of the other prefixes. The whole guard exists
 * to promise that requests never leave the frame, and a passthrough keyed on a
 * path an attacker can choose is not a promise.
 *
 * A URL that will not parse is `sameOrigin: false`: the passthroughs are all for
 * traffic the frame itself originates, which is always parseable and always
 * local, so the unparseable case belongs on the fixture path where a miss throws
 * by name.
 */
function keyOf(input: RequestInfo | URL): {
  path: string;
  full: string;
  sameOrigin: boolean;
} {
  const raw =
    typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  try {
    const u = new URL(raw, window.location.origin);
    return {
      path: u.pathname,
      full: `${u.pathname}${u.search}`,
      sameOrigin: u.origin === window.location.origin,
    };
  } catch {
    return { path: raw, full: raw, sameOrigin: false };
  }
}

let installed = false;
let eventSourceInstalled = false;

/**
 * `EventSource` is a SECOND way out of the frame, and it does not go through `fetch`.
 *
 * The guard above promises that "requests are never allowed to leave the frame", and every
 * scene mounting the real app shell broke that promise: the notification bell opens
 * `/api/notifications/stream`, which is an `EventSource`, so it bypassed the wrapper entirely
 * and reached the real backend. It was written off as one harmless console error per scene —
 * but a promise with an exception nobody can see is worse than no promise, and the browser
 * gate could not fail on it because the gate looks for the guard's own `unmocked` message.
 *
 * Refused rather than answered from fixtures: a stream has no fixture shape (the table maps a
 * URL to one JSON body), and no scene reads what the stream carries. The constructor reports
 * through the same `onMiss` path as `fetch`, so the failure is named the same way, then
 * behaves as a stream that immediately errors — which is what the app already handles when
 * the backend is down.
 */
function installEventSourceGuard(): void {
  if (eventSourceInstalled || typeof window.EventSource !== 'function') return;
  eventSourceInstalled = true;

  const Real = window.EventSource;
  class GuardedEventSource extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSED = 2;
    readonly url: string;
    readonly withCredentials = false;
    readyState = 2;
    onopen: ((e: Event) => void) | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;

    constructor(url: string | URL) {
      super();
      this.url = String(url);
      activeOnMiss(this.url, 'EVENTSOURCE');
      // Asynchronously, so a caller that assigns `onerror` after `new` still sees it.
      queueMicrotask(() => {
        const e = new Event('error');
        this.onerror?.(e);
        this.dispatchEvent(e);
      });
    }

    close(): void {
      this.readyState = 2;
    }
  }
  // Kept reachable for a consumer that legitimately needs the real one back.
  (GuardedEventSource as unknown as { real: typeof Real }).real = Real;
  window.EventSource = GuardedEventSource as unknown as typeof Real;
}

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
  installEventSourceGuard();

  const real = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const { path, full, sameOrigin } = keyOf(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();

    // Vite's own dev traffic (module fetches, the overlay's open-in-editor) and the
    // editor's own mount are ours and must pass through untouched, or the frame
    // cannot hot-update itself and cannot reach the bridge.
    //
    // `BASE`, not the prototype's literal `/__design-sdk/`: that namespace does not
    // exist in the shipped plugin, so every request to the editor's own routes fell
    // through to the miss path below and THREW. Deriving it means the passthrough
    // cannot drift from the mount again.
    //
    // `BASE` itself, not only `${BASE}/…` — the shell serves the mount point, and a
    // trailing-slash-less request to it is the same route.
    //
    // SAME-ORIGIN GATES THE WHOLE SET, not just one entry of it. Every line below
    // matches a PATH, and `keyOf` strips the origin, so an absolute cross-origin
    // URL wearing any of these prefixes reached `real()` and left the frame.
    // Every one of them names traffic this frame originates against its own dev
    // server, so nothing legitimate is cross-origin here.
    if (
      sameOrigin &&
      (path.startsWith('/@') ||
        path === BASE ||
        path.startsWith(`${BASE}/`) ||
        path.startsWith('/node_modules/') ||
        VITE_DEV_PATH_RE.test(path) ||
        DEBUG_REPORT_PATH_RE.test(path))
    ) {
      return real(input as RequestInfo, init);
    }

    // METHOD IS PART OF THE KEY. Keyed on path alone, a `POST /api/documents`
    // resolved to the LIST fixture with a 200, so the product's success branch ran
    // against a response of entirely the wrong shape and the designer watched a
    // mutation "succeed". A bare-path key now answers GET and HEAD only; any other
    // method must be keyed explicitly (`'POST /api/documents'`) or it is a miss,
    // which throws by name.
    //
    // `in` rather than `??` throughout: `null` is a legitimate response body and
    // must not read as "no fixture".
    const keys = [`${method} ${full}`, `${method} ${path}`];
    if (method === 'GET' || method === 'HEAD') keys.push(full, path);
    const key = keys.find((k) => k in activeFixtures);
    if (key !== undefined) {
      const hit = activeFixtures[key];
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
