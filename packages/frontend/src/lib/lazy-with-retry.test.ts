import { describe, expect, it, vi } from "vitest";
import {
  CHUNK_RECOVERY_INTERNALS,
  isChunkLoadError,
  loadWithRetry,
  type ChunkRecoveryEnv,
} from "./lazy-with-retry";

const { RELOAD_WINDOW_MS, RELOAD_STAMP_KEY } = CHUNK_RECOVERY_INTERNALS;

/** The message WebKit produced in Sentry WAFFLEBASE-2. */
const WEBKIT = "Importing a module script failed.";

function chunkError(message = WEBKIT) {
  return new TypeError(message);
}

interface TestEnv extends ChunkRecoveryEnv {
  store: Map<string, string>;
  reloads: number;
  reported: unknown[];
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
    now: () => clock.value,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    reload: () => {
      env.reloads += 1;
    },
    isOnline: () => true,
    report: async (error) => {
      env.reported.push(error);
    },
    // Tests never wait on the real backoff.
    delay: async () => {},
    ...overrides,
  };
  return env;
}

/**
 * `loadWithRetry` leaves its promise pending when it reloads, so a test that
 * awaited it directly would hang. This races it against a tick instead.
 */
async function settled<T>(promise: Promise<T>) {
  return Promise.race([
    promise.then(
      (value) => ({ state: "resolved" as const, value }),
      (error: unknown) => ({ state: "rejected" as const, error }),
    ),
    Promise.resolve().then(() => ({ state: "pending" as const })),
  ]);
}

describe("isChunkLoadError", () => {
  it.each([
    ["WebKit", WEBKIT],
    ["Chromium", "Failed to fetch dynamically imported module: /assets/x.js"],
    ["Firefox", "error loading dynamically imported module"],
    ["Vite CSS preload", "Unable to preload CSS for /assets/x.css"],
  ])("recognizes the %s message", (_name, message) => {
    expect(isChunkLoadError(chunkError(message))).toBe(true);
  });

  it("is case insensitive", () => {
    expect(
      isChunkLoadError(chunkError("IMPORTING A MODULE SCRIPT FAILED.")),
    ).toBe(true);
  });

  it("rejects an ordinary error thrown by a module that did load", () => {
    expect(isChunkLoadError(new TypeError("x is not a function"))).toBe(false);
  });

  it.each([[null], [undefined], [{}], [42], [""]])(
    "rejects the non-error value %p",
    (value) => {
      expect(isChunkLoadError(value)).toBe(false);
    },
  );
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

    const result = await settled(loadWithRetry(importer, env));

    expect(importer).toHaveBeenCalledTimes(2);
    expect(env.reloads).toBe(1);
    expect(env.reported).toHaveLength(1);
    expect(isChunkLoadError(env.reported[0])).toBe(true);
    // Neither resolved nor rejected: the document is being replaced.
    expect(result.state).toBe("pending");
  });

  it("does not reload twice inside the rate-limit window", async () => {
    const importer = vi.fn().mockRejectedValue(chunkError());
    const env = testEnv();

    await settled(loadWithRetry(importer, env));
    expect(env.reloads).toBe(1);

    env.clock.value += RELOAD_WINDOW_MS - 1;
    await expect(loadWithRetry(importer, env)).rejects.toThrow(WEBKIT);
    expect(env.reloads).toBe(1);
  });

  it("reloads again once the window has passed", async () => {
    const importer = vi.fn().mockRejectedValue(chunkError());
    const env = testEnv();

    await settled(loadWithRetry(importer, env));
    env.clock.value += RELOAD_WINDOW_MS;
    await settled(loadWithRetry(importer, env));

    expect(env.reloads).toBe(2);
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

  it("does not reload when the stamp is in the future", async () => {
    const importer = vi.fn().mockRejectedValue(chunkError());
    const env = testEnv();
    env.store.set(RELOAD_STAMP_KEY, String(env.clock.value + 60_000));

    await expect(loadWithRetry(importer, env)).rejects.toThrow(WEBKIT);
    expect(env.reloads).toBe(0);
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
