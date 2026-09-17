import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import {
  durableLockName,
  durableClientKey,
  acquireDurableSession,
  supportsDurableSession,
  setDurableLockForTest,
  resetElectionsForTest,
  isOpenInAnyTab,
  type DurableLock,
} from "./durable-session";

// jsdom has no Web Locks API. These cases are about how we *read* it, so a
// minimal stand-in is enough for the query surface to exist.
beforeAll(() => {
  if (!(navigator as { locks?: unknown }).locks) {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: () => Promise.resolve(undefined),
        query: async () => ({ held: [], pending: [] }),
      },
    });
  }
});

/**
 * The app elects one tab per document before the SDK ever tries.
 *
 * Two tabs are safe today only because the client key is random per session,
 * giving each its own actor. A stable key makes both tabs share one actor, and
 * then a shared checkpoint mints colliding `clientSeq` values while actor-keyed
 * pull dedup filters each tab's changes out of the other — silent edit loss. So
 * the second tab needs a different **key**, not merely a disabled store.
 */

/** An in-memory lock manager: one holder per name, and it fails fast. */
function fakeLocks(): DurableLock & { held: Set<string> } {
  const held = new Set<string>();
  return {
    held,
    async request(name) {
      if (held.has(name)) return undefined;
      held.add(name);
      return () => held.delete(name);
    },
  };
}

afterEach(() => {
  setDurableLockForTest(undefined);
  resetElectionsForTest();
  vi.restoreAllMocks();
});

/**
 * Simulates a different tab.
 *
 * Elections are shared and reference-counted *within* a tab, so a second call
 * in the same process is the same tab asking twice — which is a case we want to
 * succeed. A different tab is one that shares the lock manager but remembers
 * none of this one's elections, which is exactly what clearing the map gives.
 */
function asAnotherTab(): void {
  resetElectionsForTest();
}

describe("names", () => {
  it("scopes the lock to the user and the document", () => {
    expect(durableLockName("u1", "note-7")).toBe("wb-durable:u1:note-7");
  });

  it("uses a distinct prefix from the SDK's own lock", () => {
    // The SDK takes its own Web Lock on `apiKey/clientKey/docKey`. A collision
    // would mean the app lock and the SDK lock fighting over one name, and the
    // app lock exists precisely to be decided *first*.
    const name = durableLockName("u1", "note-7");
    expect(name.startsWith("wb-durable:")).toBe(true);
    expect(name).not.toContain("/");
  });

  it("scopes the client key to the document, not just the user", () => {
    // Per-document keeps each document on its own server-side client row, so
    // one tab's detach cannot disturb another tab holding a different document.
    expect(durableClientKey("u1", "note-7")).toBe("wb:u1:note-7");
    expect(durableClientKey("u1", "note-8")).not.toBe(
      durableClientKey("u1", "note-7"),
    );
  });
});

describe("electing a tab", () => {
  it("gives the lock to the first tab and refuses the second", async () => {
    const locks = fakeLocks();
    setDurableLockForTest(locks);

    const first = await acquireDurableSession("u1", "note-7");
    expect(first).toBeDefined();

    asAnotherTab();
    const second = await acquireDurableSession("u1", "note-7");
    expect(second).toBeUndefined();
  });

  it("shares one election between two callers in the same tab", async () => {
    // React StrictMode mounts every effect twice, and both requests are
    // enqueued before either is processed: without sharing, the second is
    // refused by the *first one's own* lock, nothing retries because the
    // dependencies did not change, and the tab reports itself non-durable for
    // good — with the name free. The feature never works in development.
    const locks = fakeLocks();
    setDurableLockForTest(locks);

    const [first, second] = await Promise.all([
      acquireDurableSession("u1", "note-7"),
      acquireDurableSession("u1", "note-7"),
    ]);

    expect(first).toBeDefined();
    expect(second).toBeDefined();
  });

  it("keeps the name until the last holder in the tab lets go", async () => {
    const locks = fakeLocks();
    setDurableLockForTest(locks);

    const first = await acquireDurableSession("u1", "note-7");
    const second = await acquireDurableSession("u1", "note-7");

    first!.release();
    expect(locks.held.has(durableLockName("u1", "note-7"))).toBe(true);

    second!.release();
    expect(locks.held.has(durableLockName("u1", "note-7"))).toBe(false);
  });

  it("frees the name when the first tab releases", async () => {
    const locks = fakeLocks();
    setDurableLockForTest(locks);

    const first = await acquireDurableSession("u1", "note-7");
    first!.release();

    asAnotherTab();
    expect(await acquireDurableSession("u1", "note-7")).toBeDefined();
  });

  it("does not block a different document", async () => {
    // Two documents open at once is ordinary; only the same document in two
    // tabs is the case the guard exists for.
    const locks = fakeLocks();
    setDurableLockForTest(locks);

    expect(await acquireDurableSession("u1", "note-7")).toBeDefined();
    expect(await acquireDurableSession("u1", "note-8")).toBeDefined();
  });

  it("releases only once, however many times it is called", async () => {
    // The release runs from an effect cleanup, which React can invoke more than
    // once in StrictMode. A second release must not free a name a *later* tab
    // has since taken.
    const locks = fakeLocks();
    setDurableLockForTest(locks);

    const handle = await acquireDurableSession("u1", "note-7");
    handle!.release();
    asAnotherTab();
    const next = await acquireDurableSession("u1", "note-7");
    handle!.release();

    expect(next).toBeDefined();
    expect(locks.held.has(durableLockName("u1", "note-7"))).toBe(true);
  });

  it("declines durability when the lock manager throws", async () => {
    // Fail closed. Durability without the guard is worse than no durability:
    // it is two tabs sharing one actor and losing each other's edits.
    setDurableLockForTest({
      request: () => Promise.reject(new Error("no locks here")),
    });

    expect(await acquireDurableSession("u1", "note-7")).toBeUndefined();
  });
});

describe("runtimes without the Web Locks API", () => {
  it("reports itself unsupported rather than pretending to guard", () => {
    // `navigator.locks` is absent on insecure origins and in older browsers.
    // The SDK's own guard no-ops there, so nothing would stop a second tab —
    // and a stable actor with no guard is the silent-edit-loss case.
    setDurableLockForTest(undefined);
    const locks = (navigator as { locks?: unknown }).locks;
    try {
      Object.defineProperty(navigator, "locks", {
        configurable: true,
        value: undefined,
      });
      expect(supportsDurableSession()).toBe(false);
    } finally {
      Object.defineProperty(navigator, "locks", {
        configurable: true,
        value: locks,
      });
    }
  });

  it("refuses to elect a tab there", async () => {
    setDurableLockForTest(undefined);
    const locks = (navigator as { locks?: unknown }).locks;
    try {
      Object.defineProperty(navigator, "locks", {
        configurable: true,
        value: undefined,
      });
      expect(await acquireDurableSession("u1", "note-7")).toBeUndefined();
    } finally {
      Object.defineProperty(navigator, "locks", {
        configurable: true,
        value: locks,
      });
    }
  });
});

describe("seeing what other tabs hold", () => {
  it("reports a document held by any tab as open", async () => {
    // The lock name carries whoever took it, and the question is about the
    // document, so the user segment is not matched.
    vi.spyOn(navigator.locks!, "query").mockResolvedValue({
      held: [{ name: "wb-durable:someone-else:note-7" }],
      pending: [],
    } as unknown as LockManagerSnapshot);

    expect(await isOpenInAnyTab("note-7")).toBe(true);
    expect(await isOpenInAnyTab("note-8")).toBe(false);
  });

  it("ignores locks that are not ours", async () => {
    // The SDK takes its own lock on `apiKey/clientKey/docKey`. Matching it
    // would make every attached document look open to the collector, which is
    // the opposite failure: nothing would ever be collected.
    vi.spyOn(navigator.locks!, "query").mockResolvedValue({
      held: [{ name: "/wb:u1:note-7/note-7" }],
      pending: [],
    } as unknown as LockManagerSnapshot);

    expect(await isOpenInAnyTab("note-7")).toBe(false);
  });

  it("says open when it cannot tell", async () => {
    // Refusing to evict costs a failed write the caller already handles.
    // Evicting a document somebody is editing costs their edits.
    vi.spyOn(navigator.locks!, "query").mockRejectedValue(new Error("nope"));
    expect(await isOpenInAnyTab("note-7")).toBe(true);
  });
});

describe("answering the store, which speaks a different key", () => {
  it("matches a lock against the SDK's scoped store key", async () => {
    // The store is keyed the way the SDK keys it — `apiKey/clientKey/docKey` —
    // and hands that key straight to this function, while a lock name ends in
    // the bare document key. Compared verbatim they can never match, which
    // turns the guard off exactly where it matters: every sweep and every
    // eviction would see every other tab's open document as idle.
    vi.spyOn(navigator.locks!, "query").mockResolvedValue({
      held: [{ name: "wb-durable:u1:note-7" }],
      pending: [],
    } as unknown as LockManagerSnapshot);

    expect(await isOpenInAnyTab("apikey-abc/wb:u1:note-7/note-7")).toBe(true);
    expect(await isOpenInAnyTab("apikey-abc/wb:u1:note-8/note-8")).toBe(false);
  });

  it("still matches a bare document key", async () => {
    vi.spyOn(navigator.locks!, "query").mockResolvedValue({
      held: [{ name: "wb-durable:u1:note-7" }],
      pending: [],
    } as unknown as LockManagerSnapshot);

    expect(await isOpenInAnyTab("note-7")).toBe(true);
  });
});
