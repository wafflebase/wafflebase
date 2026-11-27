import { readFileSync } from "fs";
import path from "path";
import vm from "vm";
import { beforeEach, describe, expect, test } from "vitest";
import {
  renderServiceWorker,
  type ServiceWorkerManifest,
} from "../../service-worker/plugin";

/**
 * Runs the shipped `sw.js` (not a copy of its logic) in a VM with an
 * in-memory Cache Storage and a scripted network, and drives its install,
 * activate and fetch events the way a browser would.
 */

const ORIGIN = "https://app.example";
const source = readFileSync(
  path.resolve(__dirname, "../../service-worker/sw.js"),
  "utf-8",
);

type Handler = (event: unknown) => void;

class FakeCache {
  entries = new Map<string, Response>();
  /** Set to make every `put` fail, as a full storage quota does. */
  full = false;
  constructor(private network: (url: string) => Promise<Response>) {}
  private key(input: string | Request) {
    return new URL(typeof input === "string" ? input : input.url, ORIGIN).href;
  }
  async match(input: string | Request) {
    return this.entries.get(this.key(input))?.clone();
  }
  async put(input: string | Request, response: Response) {
    if (this.full) throw new DOMException("quota", "QuotaExceededError");
    this.entries.set(this.key(input), response);
  }
  async add(input: string) {
    const response = await this.network(this.key(input));
    if (!response.ok) throw new TypeError("add failed");
    this.entries.set(this.key(input), response);
  }
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
  async delete(input: string | Request) {
    return this.entries.delete(this.key(input));
  }
}

function manifest(overrides: Partial<ServiceWorkerManifest> = {}) {
  return {
    version: "v1",
    base: "/",
    precache: ["/assets/index-a.js", "/assets/index-a.css"],
    assets: ["/assets/index-a.js", "/assets/index-a.css", "/assets/lazy-b.js"],
    ...overrides,
  };
}

function boot(
  m: ServiceWorkerManifest,
  shared?: { caches?: Map<string, FakeCache>; shell?: string },
) {
  const handlers = new Map<string, Handler>();
  const state = {
    online: true,
    requests: [] as string[],
    skipped: false,
    claimed: false,
    /** The server accepts the connection and never answers. */
    stalled: false,
  };
  const network = async (url: string) => {
    state.requests.push(url);
    if (!state.online) throw new TypeError("Failed to fetch");
    if (state.stalled) return new Promise<Response>(() => {});
    const pathname = new URL(url).pathname;
    if (pathname === "/index.html" && shared?.shell !== undefined) {
      return new Response(shared.shell, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    return new Response(`body of ${new URL(url).pathname}`, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  };
  const store = shared?.caches ?? new Map<string, FakeCache>();
  const caches = {
    open: async (name: string) => {
      if (!store.has(name)) store.set(name, new FakeCache(network));
      return store.get(name)!;
    },
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
  };
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type: string, handler: Handler) =>
      handlers.set(type, handler),
    skipWaiting: async () => {
      state.skipped = true;
    },
    clients: {
      claim: async () => {
        state.claimed = true;
      },
    },
  };
  // A `Response` from `fetch` is `basic` for a same-origin request.
  const fetchImpl = async (input: string | Request) => {
    const url = new URL(typeof input === "string" ? input : input.url, ORIGIN)
      .href;
    const response = await network(url);
    Object.defineProperty(response, "type", { value: "basic" });
    return response;
  };
  vm.runInNewContext(renderServiceWorker(source, m), {
    self,
    caches,
    fetch: fetchImpl,
    URL,
    Response,
    Promise,
    Set,
    Error,
    // The navigation timeout fires at once here: the tests are about which
    // answer wins, not about the two seconds.
    setTimeout: (fn: () => void) => setTimeout(fn, 0),
  });

  async function lifecycle(type: "install" | "activate") {
    let done: Promise<unknown> = Promise.resolve();
    handlers.get(type)!({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
  }

  async function request(
    url: string,
    init: { mode?: string; method?: string } = {},
  ): Promise<Response | "passthrough"> {
    const request = {
      url: new URL(url, ORIGIN).href,
      method: init.method ?? "GET",
      mode: init.mode ?? "cors",
    };
    let responded: Promise<Response> | null = null;
    handlers.get("fetch")!({
      request,
      respondWith: (p: Promise<Response>) => (responded = p),
    });
    return responded ?? "passthrough";
  }

  return { state, store, lifecycle, request };
}

describe("offline app-shell service worker", () => {
  let sw: ReturnType<typeof boot>;

  beforeEach(async () => {
    sw = boot(manifest());
    await sw.lifecycle("install");
    await sw.lifecycle("activate");
  });

  test("install caches the shell and the boot set, then takes over", async () => {
    const shell = sw.store.get("wafflebase-shell-v1")!;
    expect([...shell.entries.keys()]).toEqual([`${ORIGIN}/index.html`]);
    expect([...sw.store.get("wafflebase-assets")!.entries.keys()].sort()).toEqual(
      [`${ORIGIN}/assets/index-a.css`, `${ORIGIN}/assets/index-a.js`],
    );
    expect(sw.state.skipped).toBe(true);
    expect(sw.state.claimed).toBe(true);
  });

  test("a navigation goes to the network while it is reachable", async () => {
    const response = await sw.request("/w/team/d/1", { mode: "navigate" });
    expect(await (response as Response).text()).toBe("body of /w/team/d/1");
  });

  test("an offline navigation to any route is answered with the cached shell", async () => {
    sw.state.online = false;
    const response = await sw.request("/w/team/d/1", { mode: "navigate" });
    expect(await (response as Response).text()).toBe("body of /index.html");
  });

  test("a hashed asset is served from cache, and a lazy one is cached on first use", async () => {
    sw.state.online = false;
    const boot = await sw.request("/assets/index-a.js");
    expect(await (boot as Response).text()).toBe("body of /assets/index-a.js");

    sw.state.online = true;
    await sw.request("/assets/lazy-b.js");
    sw.state.online = false;
    const lazy = await sw.request("/assets/lazy-b.js");
    expect(await (lazy as Response).text()).toBe("body of /assets/lazy-b.js");
  });

  test.each([
    ["the API on another origin", "https://api.example/auth/me", {}],
    ["a non-GET request", "/assets/index-a.js", { method: "POST" }],
    ["the docs site", "/docs/guide/", { mode: "navigate" }],
    ["the docs root", "/docs", { mode: "navigate" }],
    ["a same-origin sign-in route", "/auth/github", { mode: "navigate" }],
    ["a same-origin API route", "/api/v1/workspaces", {}],
    ["an unhashed public file", "/icon.svg", {}],
  ])("leaves %s alone", async (_label, url, init) => {
    expect(await sw.request(url, init)).toBe("passthrough");
  });

  test("a new build drops the old shell and chunks it no longer ships", async () => {
    const caches = sw.store;
    const next = boot(
      manifest({
        version: "v2",
        precache: ["/assets/index-c.js"],
        assets: ["/assets/index-c.js", "/assets/lazy-b.js"],
      }),
      { caches },
    );
    // The chunk the previous build loaded lazily, unchanged in this one.
    await sw.request("/assets/lazy-b.js");

    await next.lifecycle("install");
    await next.lifecycle("activate");

    expect([...caches.keys()].sort()).toEqual([
      "wafflebase-assets",
      "wafflebase-shell-v2",
    ]);
    expect([...caches.get("wafflebase-assets")!.entries.keys()].sort()).toEqual(
      [`${ORIGIN}/assets/index-c.js`, `${ORIGIN}/assets/lazy-b.js`],
    );
  });

  test("an install that cannot download its boot set caches no shell", async () => {
    const fresh = boot(manifest({ version: "v3" }));
    fresh.state.online = false;
    await expect(fresh.lifecycle("install")).rejects.toThrow();
    expect(fresh.store.get("wafflebase-shell-v3")?.entries.size ?? 0).toBe(0);
    expect(fresh.state.skipped).toBe(false);
  });

  test("a navigation the server never answers gets the cached shell", async () => {
    sw.state.stalled = true;
    const response = await sw.request("/w/team/d/1", { mode: "navigate" });
    expect(await (response as Response).text()).toBe("body of /index.html");
  });

  test("a full cache does not fail a chunk the network delivered", async () => {
    sw.store.get("wafflebase-assets")!.full = true;
    const response = await sw.request("/assets/lazy-b.js");
    expect(await (response as Response).text()).toBe("body of /assets/lazy-b.js");
  });

  test("an install refuses a shell from another build", async () => {
    const fresh = boot(manifest({ version: "v4" }), {
      shell: '<script type="module" src="/assets/index-z.js"></script>',
    });
    await expect(fresh.lifecycle("install")).rejects.toThrow(/index-z/);
    expect(fresh.store.get("wafflebase-shell-v4")?.entries.size ?? 0).toBe(0);
    expect(fresh.state.skipped).toBe(false);
  });

  test("an install accepts a shell that names only this build's assets", async () => {
    const fresh = boot(manifest({ version: "v5" }), {
      shell:
        '<script type="module" crossorigin src="/assets/index-a.js"></script>' +
        '<link rel="stylesheet" href="/assets/index-a.css"><link rel="icon" href="/favicon.svg">',
    });
    await fresh.lifecycle("install");
    expect(fresh.store.get("wafflebase-shell-v5")!.entries.size).toBe(1);
  });

  // An asset of this build that the shell preloads but the plugin left out of
  // `precache` must still be cached, or that shell cannot start offline.
  test("an install caches every asset the shell names, not only the boot set", async () => {
    const fresh = boot(manifest({ version: "v6" }), {
      shell:
        '<script type="module" src="/assets/index-a.js"></script>' +
        '<link rel="modulepreload" href="/assets/lazy-b.js">',
    });
    await fresh.lifecycle("install");
    expect([...fresh.store.get("wafflebase-assets")!.entries.keys()]).toContain(
      `${ORIGIN}/assets/lazy-b.js`,
    );
  });
});
