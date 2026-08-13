import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

// Google Fonts, served from disk instead of from Google.
//
// `packages/frontend/index.html` fetches Inter / Fraunces / JetBrains Mono
// from `fonts.googleapis.com` at runtime, and the visual lane *gates* its
// capture on those three being usable (`REQUIRED_WEB_FONTS` in
// verify-visual-browser.mjs). That made every one of the ~25 capture passes
// depend on a live GitHub-runner → Google round trip, and a single failed
// `woff2` failed the job: 11 of the last 64 `verify-browser` runs died that
// way, on a rotating cast of families and profiles, none of them a
// regression in the branch under test.
//
// Waiting harder cannot fix it — a face whose fetch failed sits in
// `status: "error"` and Chromium negatively caches the `woff2`, so the
// stylesheet refetch that verify-visual-browser.mjs already does re-uses the
// same dead entry. The only fix is to stop making the request.
//
// So the requests are intercepted at the Playwright context and answered
// from committed fixtures. The fixtures are the bytes Google serves, which
// is what makes this cheap: no baseline changes, because nothing about what
// gets painted changes.
//
// Two modes:
//
//   replay (default, and what CI runs) — a recorded response is fulfilled
//     from disk. A URL that is not in the cache is aborted and reported by
//     URL, so a miss is a loud, deterministic failure telling you to
//     re-record, never a silent fallback-glyph capture.
//
//   record (`RECORD_GOOGLE_FONT_CACHE=true`) — requests go to the network
//     and every response is written into the fixture directory. Run it when
//     index.html's `css2` query changes, or when a scenario starts painting
//     a family the cache has never seen.
//
// Only `fonts.googleapis.com` (the `css2` stylesheets, including the
// per-family ones ThemedFontPicker injects) and `fonts.gstatic.com` (the
// font binaries) are intercepted. Everything else — the harness's own Vite
// origin above all — is left alone.
const FONT_URL_PATTERN = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

const INDEX_FILE = "index.json";

// Not recorded bodies, so the prune in `save()` must leave them alone.
const KEEP_FILES = new Set([INDEX_FILE, "README.md"]);

// Recorded alongside each body so a replay serves the same `Content-Type`
// Chromium parsed the first time. `Access-Control-Allow-Origin` is added on
// replay rather than recorded: `@font-face` fetches are always CORS-mode, so
// a fulfilled response without it is discarded by the font loader and the
// face lands in `status: "error"` — the very state this cache exists to
// prevent.
const REPLAY_HEADERS = {
  "access-control-allow-origin": "*",
  "cache-control": "public, max-age=31536000",
};

function extensionFor(contentType) {
  if (contentType.includes("css")) return "css";
  if (contentType.includes("woff2")) return "woff2";
  if (contentType.includes("woff")) return "woff";
  if (contentType.includes("ttf") || contentType.includes("truetype")) return "ttf";
  return "bin";
}

// Content-addressed by URL: gstatic's own basenames are opaque hashes and
// two families can share one, so the URL is the only stable key. The
// readable half of the name is a courtesy for anyone reading `git status`.
function fileNameFor(url, contentType) {
  const digest = createHash("sha256").update(url).digest("hex").slice(0, 16);
  const slug =
    url
      .replace(/^https:\/\//, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .slice(0, 48)
      .replace(/-+$/, "") || "font";
  return `${slug}-${digest}.${extensionFor(contentType)}`;
}

/**
 * Loads the fixture set and returns a handle that installs the interception
 * on a Playwright BrowserContext.
 *
 * @param {{ dir: string, record: boolean }} options
 */
export async function loadGoogleFontCache({ dir, record }) {
  /** @type {Map<string, { file: string, contentType: string }>} */
  const entries = new Map();
  let indexRaw;
  try {
    indexRaw = await readFile(path.join(dir, INDEX_FILE), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (indexRaw) {
    const parsed = JSON.parse(indexRaw);
    for (const [url, entry] of Object.entries(parsed.entries ?? {})) {
      entries.set(url, entry);
    }
  }

  /** @type {Map<string, Buffer>} */
  const bodies = new Map();
  const misses = new Set();
  // Record mode distrusts what is already on disk — refreshing is the whole
  // point of the pass, and the `css2` URL is stable across upstream font
  // versions, so honouring the stored copy would make a re-record a silent
  // no-op for the one response that names every other URL. It does honour
  // what *this* pass already fetched, so ~25 capture passes cost one request
  // per URL rather than one per pass.
  const fetchedThisRun = new Set();
  const failedThisRun = new Set();
  /** @type {Array<{ url: string, status: number }>} */
  const recordFailures = [];
  let recorded = 0;

  const bodyFor = async (url, entry) => {
    let body = bodies.get(url);
    if (!body) {
      body = await readFile(path.join(dir, entry.file));
      bodies.set(url, body);
    }
    return body;
  };

  const handle = async (route) => {
    const url = route.request().url();
    const entry = record && !fetchedThisRun.has(url) ? undefined : entries.get(url);
    if (entry) {
      let body;
      try {
        body = await bodyFor(url, entry);
      } catch (error) {
        // An index entry whose body is gone is a corrupt cache, not a miss
        // to be papered over — surface it the same way, by URL.
        if (error.code !== "ENOENT") throw error;
        misses.add(url);
        return route.abort();
      }
      return route.fulfill({
        status: 200,
        headers: { ...REPLAY_HEADERS, "content-type": entry.contentType },
        body,
      });
    }

    if (!record) {
      misses.add(url);
      return route.abort();
    }

    if (failedThisRun.has(url)) {
      // Already known bad, and the pass is already going to exit non-zero —
      // asking the remaining ~25 capture passes to confirm it just adds
      // minutes.
      return route.abort();
    }

    const response = await route.fetch();
    const status = response.status();
    if (status !== 200) {
      // Never bake a bad response into the fixtures: recording a 404 would
      // turn today's flake into tomorrow's permanent failure.
      failedThisRun.add(url);
      recordFailures.push({ url, status });
      return route.fulfill({ response });
    }
    const body = await response.body();
    const contentType = (
      response.headers()["content-type"] || "application/octet-stream"
    ).split(";")[0];
    const file = fileNameFor(url, contentType);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, file), body);
    entries.set(url, { file, contentType });
    bodies.set(url, body);
    fetchedThisRun.add(url);
    recorded += 1;
    return route.fulfill({ response, body });
  };

  return {
    async install(context) {
      await context.route(FONT_URL_PATTERN, handle);
    },

    /** URLs the capture asked for that the fixtures do not hold. */
    get misses() {
      return [...misses];
    },

    /** Responses the network refused during a record pass. */
    get recordFailures() {
      return recordFailures;
    },

    get recorded() {
      return recorded;
    },

    get size() {
      return entries.size;
    },

    /**
     * Writes the index and prunes bodies no longer referenced, so a
     * re-record after an `index.html` font change leaves no orphans behind.
     * Record mode only.
     */
    async save() {
      await mkdir(dir, { recursive: true });
      const sorted = {};
      for (const url of [...entries.keys()].sort()) {
        sorted[url] = entries.get(url);
      }
      await writeFile(
        path.join(dir, INDEX_FILE),
        `${JSON.stringify({ entries: sorted }, null, 2)}\n`,
      );
      const referenced = new Set([...entries.values()].map((e) => e.file));
      for (const name of await readdir(dir)) {
        if (KEEP_FILES.has(name) || referenced.has(name)) continue;
        await unlink(path.join(dir, name));
      }
    },
  };
}
