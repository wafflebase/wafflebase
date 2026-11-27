/*
 * Wafflebase app-shell service worker.
 *
 * Lets the app's own UI open with no network: the desktop app on a plane,
 * or a browser tab reopened while the server is down. It is deliberately
 * narrow (docs/design/frontend.md § Offline app shell):
 *
 * - Navigations are network-first. Whenever the server answers, its answer is
 *   used, whatever the status, so a deploy reaches users on their next load
 *   and nobody is held on an old build. A navigation that cannot reach the
 *   server, or gets no answer within NAVIGATION_TIMEOUT_MS while a cached shell
 *   exists, is answered with the cached `index.html`.
 * - `assets/` files are content-hashed by Vite, so they are cache-first: a
 *   name never changes content. The boot set is precached at install; every
 *   other chunk is cached the first time the app loads it, so an editor
 *   opened online once also opens offline.
 * - Everything else passes straight through untouched: other origins (the
 *   API, Yorkie, fonts), non-GET requests, the `/docs` site that shares this
 *   origin, and backend paths a same-origin deployment may serve. Nothing
 *   that carries a session or document content is ever stored.
 *
 * Plain JavaScript with no imports, so the file that ships is the file the
 * tests run (`tests/service-worker/sw.test.ts`). The build replaces the
 * manifest token below with this build's version, boot set and asset list
 * (`service-worker/plugin.ts`); a new deploy therefore changes this file's
 * bytes, which is what makes the browser install the new worker.
 */

/** @type {{ version: string, base: string, precache: string[], assets: string[] }} */
const MANIFEST = __WB_SW_MANIFEST__;

const SHELL_CACHE_PREFIX = "wafflebase-shell-";
const SHELL_CACHE = SHELL_CACHE_PREFIX + MANIFEST.version;
// Shared across versions: an unchanged chunk keeps its hash from one build to
// the next and need not be downloaded again. Pruned on activate instead.
const ASSET_CACHE = "wafflebase-assets";
const SHELL_KEY = MANIFEST.base + "index.html";
// How long a navigation waits for the server before the cached shell answers.
// A stalled connection (a TLS handshake that never completes) otherwise holds
// the navigation until the browser's own timeout, a minute or more; and the
// desktop shell, which needs a page to start loading within 3 s, would give
// up on a cache that was there all along (docs/design/desktop-app.md §2). The
// late network answer is not used: the next navigation gets the fresh build.
const NAVIGATION_TIMEOUT_MS = 2000;
const TIMED_OUT = Symbol("timed out");
const ASSET_PREFIX = MANIFEST.base + "assets/";

// Same-origin paths that are never the app: the VitePress site published
// under /docs, and backend routes on a deployment that serves the API from
// the frontend's own origin. Passed through, so a sign-in redirect or a
// cookie-setting response never runs through this worker's fetch.
const PASSTHROUGH_PREFIXES = ["docs/", "auth/", "api/", "internal/"].map(
  (p) => MANIFEST.base + p,
);

function isPassthroughPath(pathname) {
  if (pathname === MANIFEST.base + "docs") return true;
  return PASSTHROUGH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * What to do with a request: "navigate" (network-first, cached shell when
 * offline), "asset" (cache-first), or null (do not touch it at all).
 */
function classify(request) {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return null;
  if (isPassthroughPath(url.pathname)) return null;
  if (request.mode === "navigate") return "navigate";
  if (url.pathname.startsWith(ASSET_PREFIX)) return "asset";
  return null;
}

async function precache() {
  const shell = await caches.open(SHELL_CACHE);
  // `reload` skips the HTTP cache: GitHub Pages serves index.html with a
  // ten-minute max-age, and a stale copy would name assets of the build
  // before this one.
  const response = await fetch(SHELL_KEY, { cache: "reload" });
  if (!response.ok) throw new Error(`shell fetch failed: ${response.status}`);
  // The shell comes from the server, the boot set from this worker's manifest.
  // A deploy that lands between the two would pair a new shell with the old
  // build's chunks, and that shell could not start offline. Refuse it: the
  // install fails and the previous worker keeps serving until the next one.
  // Every asset the shell names is cached with the boot set, so a shell that
  // preloads something the plugin left out of `precache` still starts offline.
  const html = await response.clone().text();
  const known = new Set(MANIFEST.assets);
  const escaped = ASSET_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const referenced = new RegExp(`["'](${escaped}[^"'?#]+)`, "g");
  const boot = new Set(MANIFEST.precache);
  for (const match of html.matchAll(referenced)) {
    if (!known.has(match[1])) {
      throw new Error(`shell references ${match[1]}, not part of this build`);
    }
    boot.add(match[1]);
  }
  const assets = await caches.open(ASSET_CACHE);
  await Promise.all(
    [...boot].map(async (path) => {
      if (await assets.match(path)) return;
      await assets.add(path);
    }),
  );
  // Last, so a worker whose boot set failed to download never answers an
  // offline navigation with a page that cannot start.
  await shell.put(SHELL_KEY, response);
}

async function cleanup() {
  for (const name of await caches.keys()) {
    if (name.startsWith(SHELL_CACHE_PREFIX) && name !== SHELL_CACHE) {
      await caches.delete(name);
    }
  }
  // Drop chunks no longer part of the current build, or the cache would grow
  // by every build's lazily loaded chunks forever.
  const keep = new Set(MANIFEST.assets);
  const assets = await caches.open(ASSET_CACHE);
  for (const request of await assets.keys()) {
    if (!keep.has(new URL(request.url).pathname)) {
      await assets.delete(request);
    }
  }
}

async function handleNavigate(request) {
  const shell = await caches.open(SHELL_CACHE);
  const network = fetch(request);
  // Answered from cache after a timeout, the network's late result has no one
  // to report to; keep its rejection from surfacing as unhandled.
  network.catch(() => {});
  try {
    const first = await Promise.race([
      network,
      new Promise((resolve) =>
        setTimeout(() => resolve(TIMED_OUT), NAVIGATION_TIMEOUT_MS),
      ),
    ]);
    if (first !== TIMED_OUT) return first;
    const cached = await shell.match(SHELL_KEY);
    // No cached shell: nothing better than waiting for the network.
    return cached ?? (await network);
  } catch (error) {
    const cached = await shell.match(SHELL_KEY);
    if (cached) return cached;
    throw error;
  }
}

async function handleAsset(request) {
  const assets = await caches.open(ASSET_CACHE);
  const cached = await assets.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    // Best effort: a full quota must not turn a chunk the network delivered
    // into a failed load. Only install's precache is all-or-nothing.
    try {
      await assets.put(request, response.clone());
    } catch {
      // Served uncached; the next load tries again.
    }
  }
  return response;
}

self.addEventListener("install", (event) => {
  // Taking over at once is safe because navigations are network-first: a
  // page from the previous build keeps fetching its own chunks, which miss
  // this cache and go to the network as they always did.
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(cleanup().then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const kind = classify(event.request);
  if (kind === "navigate") event.respondWith(handleNavigate(event.request));
  else if (kind === "asset") event.respondWith(handleAsset(event.request));
});
