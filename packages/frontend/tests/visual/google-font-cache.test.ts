import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Plain .mjs, shared with the Playwright harness scripts — no declaration file.
// @ts-expect-error -- untyped script module
import { loadGoogleFontCache } from "../../scripts/google-font-cache.mjs";

const CSS_URL =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap";
const WOFF2_URL = "https://fonts.gstatic.com/s/inter/v20/abc.woff2";

const dirs: string[] = [];

async function tempCacheDir() {
  const dir = await mkdtemp(path.join(tmpdir(), "wb-font-cache-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Collects the handler `install()` registers, the way a BrowserContext would. */
function fakeContext() {
  const state: { handler?: (route: unknown) => Promise<unknown> } = {};
  return {
    context: {
      route: (_pattern: RegExp, handler: (route: unknown) => Promise<unknown>) => {
        state.handler = handler;
      },
    },
    get handler() {
      if (!state.handler) throw new Error("install() registered no handler");
      return state.handler;
    },
  };
}

function fakeRoute(url: string, response?: unknown) {
  return {
    request: () => ({ url: () => url }),
    fulfill: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
    fetch: vi.fn(async () => response),
  };
}

function fakeResponse({ status = 200, body = Buffer.from("bytes"), contentType = "font/woff2" } = {}) {
  return {
    status: () => status,
    body: async () => body,
    headers: () => ({ "content-type": contentType }),
  };
}

describe("google font cache — replay", () => {
  it("fulfills a recorded response from disk", async () => {
    const dir = await tempCacheDir();
    await writeFile(path.join(dir, "inter.woff2"), Buffer.from("woff2-bytes"));
    await writeFile(
      path.join(dir, "index.json"),
      JSON.stringify({
        entries: { [WOFF2_URL]: { file: "inter.woff2", contentType: "font/woff2" } },
      }),
    );

    const cache = await loadGoogleFontCache({ dir, record: false });
    const ctx = fakeContext();
    await cache.install(ctx.context);

    const route = fakeRoute(WOFF2_URL);
    await ctx.handler(route);

    expect(route.abort).not.toHaveBeenCalled();
    const [call] = route.fulfill.mock.calls;
    expect(call[0].status).toBe(200);
    expect(call[0].body.toString()).toBe("woff2-bytes");
    expect(call[0].headers["content-type"]).toBe("font/woff2");
    // Font fetches are CORS-mode: without this the face lands in `error`.
    expect(call[0].headers["access-control-allow-origin"]).toBe("*");
    expect(cache.misses).toEqual([]);
  });

  it("aborts an unrecorded request and reports it by URL", async () => {
    const dir = await tempCacheDir();
    const cache = await loadGoogleFontCache({ dir, record: false });
    const ctx = fakeContext();
    await cache.install(ctx.context);

    const route = fakeRoute(CSS_URL);
    await ctx.handler(route);

    expect(route.fulfill).not.toHaveBeenCalled();
    expect(route.abort).toHaveBeenCalledOnce();
    expect(cache.misses).toEqual([CSS_URL]);
  });

  it("treats an index entry whose body is gone as a miss, not a crash", async () => {
    const dir = await tempCacheDir();
    await writeFile(
      path.join(dir, "index.json"),
      JSON.stringify({
        entries: { [WOFF2_URL]: { file: "vanished.woff2", contentType: "font/woff2" } },
      }),
    );

    const cache = await loadGoogleFontCache({ dir, record: false });
    const ctx = fakeContext();
    await cache.install(ctx.context);

    const route = fakeRoute(WOFF2_URL);
    await ctx.handler(route);

    expect(route.abort).toHaveBeenCalledOnce();
    expect(cache.misses).toEqual([WOFF2_URL]);
  });

  it("never reaches the network", async () => {
    const dir = await tempCacheDir();
    const cache = await loadGoogleFontCache({ dir, record: false });
    const ctx = fakeContext();
    await cache.install(ctx.context);

    const route = fakeRoute(WOFF2_URL);
    await ctx.handler(route);

    expect(route.fetch).not.toHaveBeenCalled();
  });
});

describe("google font cache — record", () => {
  it("writes the body, indexes it, and serves it on the next replay", async () => {
    const dir = await tempCacheDir();
    const cache = await loadGoogleFontCache({ dir, record: true });
    const ctx = fakeContext();
    await cache.install(ctx.context);

    const route = fakeRoute(WOFF2_URL, fakeResponse({ body: Buffer.from("fresh") }));
    await ctx.handler(route);
    await cache.save();

    expect(cache.recorded).toBe(1);
    expect(cache.recordFailures).toEqual([]);

    const index = JSON.parse(await readFile(path.join(dir, "index.json"), "utf8"));
    const entry = index.entries[WOFF2_URL];
    expect(entry.contentType).toBe("font/woff2");
    expect(entry.file.endsWith(".woff2")).toBe(true);
    expect((await readFile(path.join(dir, entry.file))).toString()).toBe("fresh");

    const replay = await loadGoogleFontCache({ dir, record: false });
    const replayCtx = fakeContext();
    await replay.install(replayCtx.context);
    const replayRoute = fakeRoute(WOFF2_URL);
    await replayCtx.handler(replayRoute);
    expect(replay.misses).toEqual([]);
    expect(replayRoute.fulfill.mock.calls[0][0].body.toString()).toBe("fresh");
  });

  it("refetches a URL already on disk — refreshing is the point of the pass", async () => {
    const dir = await tempCacheDir();
    await writeFile(path.join(dir, "old.css"), "stale-css");
    await writeFile(
      path.join(dir, "index.json"),
      JSON.stringify({
        entries: { [CSS_URL]: { file: "old.css", contentType: "text/css" } },
      }),
    );

    const cache = await loadGoogleFontCache({ dir, record: true });
    const ctx = fakeContext();
    await cache.install(ctx.context);

    const route = fakeRoute(
      CSS_URL,
      fakeResponse({ body: Buffer.from("new-css"), contentType: "text/css" }),
    );
    await ctx.handler(route);
    await cache.save();

    // The css2 URL never changes when Google ships a new font version, so
    // honouring the stored copy would make a re-record a silent no-op.
    expect(route.fetch).toHaveBeenCalledOnce();
    const index = JSON.parse(await readFile(path.join(dir, "index.json"), "utf8"));
    const entry = index.entries[CSS_URL];
    expect((await readFile(path.join(dir, entry.file))).toString()).toBe("new-css");
    expect(await readdir(dir)).not.toContain("old.css");
  });

  it("fetches each URL once per pass, not once per capture", async () => {
    const dir = await tempCacheDir();
    const cache = await loadGoogleFontCache({ dir, record: true });
    const ctx = fakeContext();
    await cache.install(ctx.context);

    const first = fakeRoute(WOFF2_URL, fakeResponse({ body: Buffer.from("once") }));
    await ctx.handler(first);
    const second = fakeRoute(WOFF2_URL, fakeResponse({ body: Buffer.from("twice") }));
    await ctx.handler(second);

    expect(first.fetch).toHaveBeenCalledOnce();
    expect(second.fetch).not.toHaveBeenCalled();
    expect(cache.recorded).toBe(1);
    expect(second.fulfill.mock.calls[0][0].body.toString()).toBe("once");
  });

  it("refuses to record a non-200 rather than baking it into the fixtures", async () => {
    const dir = await tempCacheDir();
    const cache = await loadGoogleFontCache({ dir, record: true });
    const ctx = fakeContext();
    await cache.install(ctx.context);

    const route = fakeRoute(WOFF2_URL, fakeResponse({ status: 404 }));
    await ctx.handler(route);

    expect(cache.recorded).toBe(0);
    expect(cache.recordFailures).toEqual([{ url: WOFF2_URL, status: 404 }]);
    expect(cache.size).toBe(0);
    // The page still gets the real response, so the capture fails the way it
    // would have without the cache — the record pass reports and exits.
    expect(route.fulfill).toHaveBeenCalledOnce();

    // And the remaining passes do not spend a request each re-confirming it.
    const retry = fakeRoute(WOFF2_URL, fakeResponse({ status: 404 }));
    await ctx.handler(retry);
    expect(retry.fetch).not.toHaveBeenCalled();
    expect(retry.abort).toHaveBeenCalledOnce();
    expect(cache.recordFailures).toHaveLength(1);
  });

  it("prunes bodies the refreshed index no longer references", async () => {
    const dir = await tempCacheDir();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "orphan-from-an-older-css2-query.woff2"), "stale");
    // Documentation, not a recorded body — the prune must not eat it.
    await writeFile(path.join(dir, "README.md"), "# fixtures");

    const cache = await loadGoogleFontCache({ dir, record: true });
    const ctx = fakeContext();
    await cache.install(ctx.context);
    await ctx.handler(fakeRoute(CSS_URL, fakeResponse({ contentType: "text/css" })));
    await cache.save();

    const remaining = await readdir(dir);
    expect(remaining).not.toContain("orphan-from-an-older-css2-query.woff2");
    expect(remaining).toContain("index.json");
    expect(remaining).toContain("README.md");
    expect(remaining.some((name) => name.endsWith(".css"))).toBe(true);
  });
});
