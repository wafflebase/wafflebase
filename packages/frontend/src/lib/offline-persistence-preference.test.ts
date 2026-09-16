import { describe, expect, it, vi, beforeEach } from "vitest";

const STORAGE_KEY = "wafflebase-offline-persistence";

/**
 * The session mirror is module state, so a test that leaves it set would
 * decide the next test's answer. Each case loads its own copy of the module
 * instead, which keeps a failure pointing at the property it names.
 */
async function load() {
  return import("./offline-persistence-preference");
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  localStorage.clear();
});

describe("offline persistence preference", () => {
  it("defaults to off", async () => {
    const { getOfflinePersistenceEnabled } = await load();
    expect(getOfflinePersistenceEnabled()).toBe(false);
  });

  it("round-trips through localStorage", async () => {
    const { getOfflinePersistenceEnabled, setOfflinePersistenceEnabled } =
      await load();

    setOfflinePersistenceEnabled(true);
    expect(getOfflinePersistenceEnabled()).toBe(true);

    setOfflinePersistenceEnabled(false);
    expect(getOfflinePersistenceEnabled()).toBe(false);
  });

  it("notifies subscribers in the same tab", async () => {
    // `storage` only fires in *other* tabs, so Settings and an editor mounted
    // in the same tab need their own event or the editor never learns.
    const { setOfflinePersistenceEnabled, subscribeOfflinePersistence } =
      await load();

    let calls = 0;
    const unsubscribe = subscribeOfflinePersistence(() => {
      calls += 1;
    });
    setOfflinePersistenceEnabled(true);
    expect(calls).toBe(1);

    unsubscribe();
    setOfflinePersistenceEnabled(false);
    expect(calls).toBe(1);
  });

  it("keeps the choice for the session when storage refuses the write", async () => {
    // Safari private mode throws on setItem. A browser that will not persist a
    // preference is also one that will not give us IndexedDB, so the store
    // reports itself undurable for its own reasons — but the toggle must not
    // silently snap back in the UI.
    const { getOfflinePersistenceEnabled, setOfflinePersistenceEnabled } =
      await load();

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    setOfflinePersistenceEnabled(true);
    expect(getOfflinePersistenceEnabled()).toBe(true);
  });

  it("stops preferring the mirror once a write succeeds", async () => {
    // A mirror left over from a failed write would outvote the key another tab
    // has since changed — so the divergence only shows after storage moves on
    // its own, which is what this reproduces.
    const { getOfflinePersistenceEnabled, setOfflinePersistenceEnabled } =
      await load();

    const setItem = vi.spyOn(Storage.prototype, "setItem");
    setItem.mockImplementationOnce(() => {
      throw new Error("QuotaExceededError");
    });
    setOfflinePersistenceEnabled(true);

    // This write lands, so the mirror must give way to storage again.
    setOfflinePersistenceEnabled(true);

    // Another tab turns it off.
    localStorage.setItem(STORAGE_KEY, "false");
    expect(getOfflinePersistenceEnabled()).toBe(false);
  });

  it("reads as off when touching localStorage throws", async () => {
    // SecurityError in Safari private mode and sandboxed iframes. This is a
    // `useSyncExternalStore` snapshot, so a throw here runs during render.
    const { getOfflinePersistenceEnabled } = await load();

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(getOfflinePersistenceEnabled()).toBe(false);
  });

  it("does not throw out of the setter when storage refuses the write", async () => {
    // It runs from the Switch's `onCheckedChange`; a throw there would surface
    // as an unhandled error rather than a preference that did not persist.
    const { setOfflinePersistenceEnabled } = await load();

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => setOfflinePersistenceEnabled(true)).not.toThrow();
  });
});
