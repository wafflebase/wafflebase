import { describe, expect, it, vi, beforeEach } from "vitest";

const STORAGE_KEY = "wafflebase-offline-persistence";

/** Whoever is signed in; the preference is recorded per account. */
const USER = "u1";

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
    expect(getOfflinePersistenceEnabled(USER)).toBe(false);
  });

  it("round-trips through localStorage", async () => {
    const { getOfflinePersistenceEnabled, setOfflinePersistenceEnabled } =
      await load();

    setOfflinePersistenceEnabled(USER, true);
    expect(getOfflinePersistenceEnabled(USER)).toBe(true);

    setOfflinePersistenceEnabled(USER, false);
    expect(getOfflinePersistenceEnabled(USER)).toBe(false);
  });

  it("does not opt one account in because another did on this device", async () => {
    // The whole point of a per-device setting is the shared machine, and a
    // device-wide answer gets that case backwards: one user's consent would
    // start writing the *next* user's document content to that disk, without
    // that account ever being asked and with the Settings switch showing "on"
    // for a choice they did not make.
    const { getOfflinePersistenceEnabled, setOfflinePersistenceEnabled } =
      await load();

    setOfflinePersistenceEnabled(USER, true);

    expect(getOfflinePersistenceEnabled("u2")).toBe(false);
    // And turning it on for them leaves the first account's answer alone.
    setOfflinePersistenceEnabled("u2", true);
    expect(getOfflinePersistenceEnabled(USER)).toBe(true);
    // As does turning it off again.
    setOfflinePersistenceEnabled("u2", false);
    expect(getOfflinePersistenceEnabled(USER)).toBe(true);
    expect(getOfflinePersistenceEnabled("u2")).toBe(false);
  });

  it("reads as off for an account nobody can name", async () => {
    // Every consumer either knows who is signed in or is in no position to
    // persist anything for them, so an absent identity is off rather than the
    // device's answer.
    const { getOfflinePersistenceEnabled, setOfflinePersistenceEnabled } =
      await load();

    setOfflinePersistenceEnabled(USER, true);
    expect(getOfflinePersistenceEnabled(undefined)).toBe(false);
  });

  it("reads a device-wide `true` as nobody's consent", async () => {
    // The shape an unqualified spelling of this key would have left behind.
    // Honoring it for whoever happens to be signed in is exactly the leak the
    // per-account set exists to close, so junk reads as off.
    const { getOfflinePersistenceEnabled } = await load();

    localStorage.setItem(STORAGE_KEY, "true");
    expect(getOfflinePersistenceEnabled(USER)).toBe(false);
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
    setOfflinePersistenceEnabled(USER, true);
    expect(calls).toBe(1);

    unsubscribe();
    setOfflinePersistenceEnabled(USER, false);
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
    setOfflinePersistenceEnabled(USER, true);
    expect(getOfflinePersistenceEnabled(USER)).toBe(true);
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
    setOfflinePersistenceEnabled(USER, true);

    // This write lands, so the mirror must give way to storage again.
    setOfflinePersistenceEnabled(USER, true);

    // Another tab turns it off.
    localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
    expect(getOfflinePersistenceEnabled(USER)).toBe(false);
  });

  it("reads as off when touching localStorage throws", async () => {
    // SecurityError in Safari private mode and sandboxed iframes. This is a
    // `useSyncExternalStore` snapshot, so a throw here runs during render.
    const { getOfflinePersistenceEnabled } = await load();

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(getOfflinePersistenceEnabled(USER)).toBe(false);
  });

  it("does not throw out of the setter when storage refuses the write", async () => {
    // It runs from the Switch's `onCheckedChange`; a throw there would surface
    // as an unhandled error rather than a preference that did not persist.
    const { setOfflinePersistenceEnabled } = await load();

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => setOfflinePersistenceEnabled(USER, true)).not.toThrow();
  });

  it("yields to another tab after a write of ours failed", async () => {
    // The mirror exists so a refused write still applies for this session. But
    // it must not outlive its reason: once another tab changes the key, that
    // is a real value and ours is a guess about storage that would not take
    // it. Without clearing, the reader keeps answering the stale guess while
    // the `storage` event tells every subscriber something changed — so the
    // editor and Settings disagree, and only a reload settles it.
    //
    // The round-trip case cannot reach this: it writes successfully first,
    // which clears the mirror before the event ever arrives.
    const { getOfflinePersistenceEnabled, setOfflinePersistenceEnabled } =
      await load();

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    setOfflinePersistenceEnabled(USER, true);
    expect(getOfflinePersistenceEnabled(USER)).toBe(true);
    vi.restoreAllMocks();

    // Another tab turns it off, which arrives as a `storage` event.
    localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: STORAGE_KEY,
        newValue: "[]",
        storageArea: localStorage,
      }),
    );

    expect(getOfflinePersistenceEnabled(USER)).toBe(false);
  });

  it("keeps the mirror when another key changes", async () => {
    // A `storage` event for somebody else's key says nothing about ours.
    const { getOfflinePersistenceEnabled, setOfflinePersistenceEnabled } =
      await load();

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    setOfflinePersistenceEnabled(USER, true);
    vi.restoreAllMocks();

    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "wafflebase-date-format",
        newValue: "exact",
        storageArea: localStorage,
      }),
    );

    expect(getOfflinePersistenceEnabled(USER)).toBe(true);
  });
});
