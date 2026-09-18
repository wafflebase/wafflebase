import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserEnv,
  CHUNK_RECOVERY_INTERNALS,
  loadWithRetry,
  type ChunkRecoveryEnv,
} from "./lazy-with-retry";
import { isChunkLoadError } from "./chunk-load-error";
import {
  registerUnsavedWorkProbe,
  resetUnsavedWorkProbes,
} from "./unsaved-work";

const {
  RETRY_DELAY_MS,
  RELOAD_WINDOW_MS,
  RELOAD_GRACE_MS,
  RELOAD_STAMP_KEY,
} = CHUNK_RECOVERY_INTERNALS;

/** The message WebKit produced in Sentry WAFFLEBASE-2. */
const WEBKIT = "Importing a module script failed.";

function chunkError(message = WEBKIT) {
  return new TypeError(message);
}

interface TestEnv extends ChunkRecoveryEnv {
  store: Map<string, string>;
  reloads: number;
  reported: unknown[];
  /** Failures the in-place retry absorbed. */
  recovered: unknown[];
  /** Every `delay(ms)` the code under test asked for, in order. */
  waits: number[];
  clock: { value: number };
}

function testEnv(overrides: Partial<ChunkRecoveryEnv> = {}): TestEnv {
  const store = new Map<string, string>();
  const clock = { value: 1_000_000 };
  const env: TestEnv = {
    store,
    clock,
    reloads: 0,
    reported: [],
    recovered: [],
    waits: [],
    now: () => clock.value,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    reload: () => {
      env.reloads += 1;
    },
    isOnline: () => true,
    hasUnsavedWork: () => false,
    report: async (error) => {
      env.reported.push(error);
    },
    noteRecovered: (error) => {
      env.recovered.push(error);
    },
    // Tests never wait on real time. Recording the request is what lets them
    // assert WHICH wait happened.
    delay: async (ms) => {
      env.waits.push(ms);
    },
    ...overrides,
  };
  return env;
}

/**
 * Watches a promise without awaiting it, so a test can assert that it has NOT
 * settled. Awaiting would hang on the reload path, and racing it against a
 * single tick proves nothing — the loser of that race is "pending" whatever it
 * would eventually do.
 */
function watch<T>(promise: Promise<T>) {
  const state = { settled: false, rejected: false, error: undefined as unknown };
  promise.then(
    () => {
      state.settled = true;
    },
    (error: unknown) => {
      state.settled = true;
      state.rejected = true;
      state.error = error;
    },
  );
  return state;
}

/** Drains the microtask queue so anything that *can* settle already has. */
async function drain() {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
}

afterEach(() => {
  resetUnsavedWorkProbes();
});

describe("loadWithRetry", () => {
  it("returns the module and imports once when nothing fails", async () => {
    const importer = vi.fn().mockResolvedValue({ default: "route" });
    const env = testEnv();

    await expect(loadWithRetry(importer, env)).resolves.toEqual({
      default: "route",
    });
    expect(importer).toHaveBeenCalledTimes(1);
    expect(env.reloads).toBe(0);
  });

  it("recovers when the retry succeeds, without reloading", async () => {
    const importer = vi
      .fn()
      .mockRejectedValueOnce(chunkError())
      .mockResolvedValue({ default: "route" });
    const env = testEnv();

    await expect(loadWithRetry(importer, env)).resolves.toEqual({
      default: "route",
    });
    expect(importer).toHaveBeenCalledTimes(2);
    expect(env.reloads).toBe(0);
    expect(env.reported).toHaveLength(0);
    // Recovering must not erase the evidence. A retry that works is the
    // expected common case for a transient mobile failure, and with no record
    // of it the whole class of incident becomes invisible the day this ships.
    expect(env.recovered).toHaveLength(1);
    expect(isChunkLoadError(env.recovered[0])).toBe(true);
  });

  it("notes nothing when the first attempt succeeds", async () => {
    const importer = vi.fn().mockResolvedValue({ default: "route" });
    const env = testEnv();

    await loadWithRetry(importer, env);

    expect(env.recovered).toHaveLength(0);
  });

  it("does not retry a module that loaded and then threw", async () => {
    const bug = new TypeError("cannot read properties of undefined");
    const importer = vi.fn().mockRejectedValue(bug);
    const env = testEnv();

    await expect(loadWithRetry(importer, env)).rejects.toBe(bug);
    expect(importer).toHaveBeenCalledTimes(1);
    expect(env.reloads).toBe(0);
  });

  it("rethrows a non-chunk error surfaced by the retry", async () => {
    const bug = new TypeError("boom");
    const importer = vi
      .fn()
      .mockRejectedValueOnce(chunkError())
      .mockRejectedValue(bug);
    const env = testEnv();

    await expect(loadWithRetry(importer, env)).rejects.toBe(bug);
    expect(env.reloads).toBe(0);
  });

  it("reloads once when both attempts fail, and reports first", async () => {
    const importer = vi.fn().mockRejectedValue(chunkError());
    const env = testEnv();

    await loadWithRetry(importer, env).catch(() => {});

    expect(importer).toHaveBeenCalledTimes(2);
    expect(env.reloads).toBe(1);
    expect(env.reported).toHaveLength(1);
    expect(isChunkLoadError(env.reported[0])).toBe(true);
    // The backoff, then the grace window that holds the Suspense fallback
    // across the reload.
    expect(env.waits).toEqual([RETRY_DELAY_MS, RELOAD_GRACE_MS]);
  });

  it("stays unsettled while the reload is taking effect", async () => {
    // The real browser never comes back from here — the document is replaced.
    // Modelled by a grace wait that never resolves.
    const importer = vi.fn().mockRejectedValue(chunkError());
    const env = testEnv({
      delay: (ms) =>
        ms === RELOAD_GRACE_MS ? new Promise<void>(() => {}) : Promise.resolve(),
    });

    const state = watch(loadWithRetry(importer, env));
    await drain();

    expect(env.reloads).toBe(1);
    // Rejecting here would flash the crash screen over a page already being
    // replaced; resolving would mount a route whose chunk never loaded.
    expect(state.settled).toBe(false);
  });

  it("falls through to the boundary when the reload does not take", async () => {
    // A browser that refused the reload. The grace window ends, and the user
    // gets the fallback instead of a spinner with no way out.
    const importer = vi.fn().mockRejectedValue(chunkError());
    const env = testEnv({ reload: () => {} });

    await expect(loadWithRetry(importer, env)).rejects.toThrow(WEBKIT);
    expect(env.waits).toContain(RELOAD_GRACE_MS);
  });

  it("reloads even when reporting the failure throws", async () => {
    // The rate-limit budget is spent by the time `report` runs, so letting it
    // propagate would cost the reload AND the retry allowance.
    const importer = vi.fn().mockRejectedValue(chunkError());
    const env = testEnv({
      report: () => Promise.reject(new Error("sentry unreachable")),
    });

    await expect(loadWithRetry(importer, env)).rejects.toThrow(WEBKIT);
    expect(env.reloads).toBe(1);
  });

  it("falls through to the boundary when reload() itself throws", async () => {
    const importer = vi.fn().mockRejectedValue(chunkError());
    const env = testEnv({
      reload: () => {
        throw new Error("navigation blocked");
      },
    });

    await expect(loadWithRetry(importer, env)).rejects.toThrow(WEBKIT);
  });

  it("does not reload twice inside the rate-limit window", async () => {
    const importer = vi.fn().mockRejectedValue(chunkError());
    const env = testEnv();

    await loadWithRetry(importer, env).catch(() => {});
    expect(env.reloads).toBe(1);

    env.clock.value += RELOAD_WINDOW_MS - 1;
    await expect(loadWithRetry(importer, env)).rejects.toThrow(WEBKIT);
    expect(env.reloads).toBe(1);
  });

  it("reloads again once the window has passed", async () => {
    const importer = vi.fn().mockRejectedValue(chunkError());
    const env = testEnv();

    await loadWithRetry(importer, env).catch(() => {});
    env.clock.value += RELOAD_WINDOW_MS;
    await loadWithRetry(importer, env).catch(() => {});

    expect(env.reloads).toBe(2);
  });

  it("does not reload while a document has unsent edits", async () => {
    const importer = vi.fn().mockRejectedValue(chunkError());
    const env = testEnv({ hasUnsavedWork: () => true });

    await expect(loadWithRetry(importer, env)).rejects.toThrow(WEBKIT);
    expect(env.reloads).toBe(0);
    // Declining must not spend the rate-limit budget either: the next chunk
    // failure, once the work is saved, still deserves its reload.
    expect(env.store.size).toBe(0);
  });

  it("does not reload while offline", async () => {
    const importer = vi.fn().mockRejectedValue(chunkError());
    const env = testEnv({ isOnline: () => false });

    await expect(loadWithRetry(importer, env)).rejects.toThrow(WEBKIT);
    expect(env.reloads).toBe(0);
    expect(env.store.size).toBe(0);
  });

  it("does not reload when the stamp cannot be persisted", async () => {
    // Safari private mode: `setItem` throws, `browserEnv` swallows it, and
    // without this check the guard would have nothing stopping a loop.
    const importer = vi.fn().mockRejectedValue(chunkError());
    const env = testEnv({ setItem: () => {} });

    await expect(loadWithRetry(importer, env)).rejects.toThrow(WEBKIT);
    expect(env.reloads).toBe(0);
  });

  it("does not reload when the stored stamp is unparseable", async () => {
    const importer = vi.fn().mockRejectedValue(chunkError());
    const env = testEnv();
    env.store.set(RELOAD_STAMP_KEY, "not-a-number");

    await expect(loadWithRetry(importer, env)).rejects.toThrow(WEBKIT);
    expect(env.reloads).toBe(0);
    // The bad value is left alone: overwriting it would hand a loop a fresh
    // budget on every pass.
    expect(env.store.get(RELOAD_STAMP_KEY)).toBe("not-a-number");
  });

  it("refuses a future-dated stamp but clamps it instead of latching", async () => {
    // A clock that moved backwards, or a restored tab. Refusing this pass is
    // right; leaving the stamp alone would disable recovery for the rest of
    // the tab's life, since nothing else ever rewrites it.
    const importer = vi.fn().mockRejectedValue(chunkError());
    const env = testEnv();
    env.store.set(RELOAD_STAMP_KEY, String(env.clock.value + 60_000));

    await expect(loadWithRetry(importer, env)).rejects.toThrow(WEBKIT);
    expect(env.reloads).toBe(0);
    expect(env.store.get(RELOAD_STAMP_KEY)).toBe(String(env.clock.value));

    // And the clamp opens no loop: the ordinary window still applies.
    env.clock.value += RELOAD_WINDOW_MS - 1;
    await expect(loadWithRetry(importer, env)).rejects.toThrow(WEBKIT);
    expect(env.reloads).toBe(0);

    env.clock.value += 1;
    await loadWithRetry(importer, env).catch(() => {});
    expect(env.reloads).toBe(1);
  });

  it("rejects with the original error, not the retry's", async () => {
    const first = chunkError("Importing a module script failed.");
    const second = chunkError("Failed to fetch dynamically imported module: x");
    const importer = vi
      .fn()
      .mockRejectedValueOnce(first)
      .mockRejectedValue(second);
    const env = testEnv({ isOnline: () => false });

    await expect(loadWithRetry(importer, env)).rejects.toBe(first);
  });
});

/**
 * The env every test above replaces, and the only one production uses. Its
 * whole job is to translate browser APIs that throw, lie or are missing into
 * the total functions `canReload` reasons about, so the translation is what
 * these assert. `reload` is excluded deliberately: jsdom implements
 * `location.reload` as a not-implemented stub, so any assertion about it would
 * be about jsdom.
 */
describe("browserEnv", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("round-trips the reload stamp through sessionStorage", () => {
    const env = browserEnv();

    expect(env.getItem(RELOAD_STAMP_KEY)).toBeNull();
    env.setItem(RELOAD_STAMP_KEY, "1234");
    expect(env.getItem(RELOAD_STAMP_KEY)).toBe("1234");
    expect(window.sessionStorage.getItem(RELOAD_STAMP_KEY)).toBe("1234");
  });

  it("reports null rather than throwing when reads are blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });

    expect(browserEnv().getItem(RELOAD_STAMP_KEY)).toBeNull();
  });

  it("swallows a blocked write, leaving the guard to notice", () => {
    // Safari private mode. `canReload` re-reads to confirm the write took, so
    // swallowing here means "no reload" rather than "unguarded reload".
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    const env = browserEnv();
    expect(() => env.setItem(RELOAD_STAMP_KEY, "1234")).not.toThrow();
    expect(env.getItem(RELOAD_STAMP_KEY)).toBeNull();
  });

  it("treats only an explicit navigator.onLine === false as offline", () => {
    const onLine = vi.spyOn(navigator, "onLine", "get");

    onLine.mockReturnValue(false);
    expect(browserEnv().isOnline()).toBe(false);

    onLine.mockReturnValue(true);
    expect(browserEnv().isOnline()).toBe(true);

    // A platform that does not implement it must not read as offline.
    onLine.mockReturnValue(undefined as unknown as boolean);
    expect(browserEnv().isOnline()).toBe(true);
  });

  it("reads unsaved work from the shared probe registry", () => {
    const env = browserEnv();
    expect(env.hasUnsavedWork()).toBe(false);

    const unregister = registerUnsavedWorkProbe(() => true);
    expect(env.hasUnsavedWork()).toBe(true);

    unregister();
    expect(env.hasUnsavedWork()).toBe(false);
  });

  it("waits the requested time", async () => {
    vi.useFakeTimers();
    try {
      const state = watch(browserEnv().delay(5_000));
      await drain();
      expect(state.settled).toBe(false);

      vi.advanceTimersByTime(5_000);
      await drain();
      expect(state.settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
