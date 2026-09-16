import "fake-indexeddb/auto";
import { describe, it, expect, vi, afterEach } from "vitest";
import { WafflebaseDocStore } from "./wafflebase-doc-store";

/**
 * Cleanup is entirely ours. The SDK calls `remove` only on its three
 * unrecoverable paths and never on a normal detach — which is correct, since
 * not removing is what makes resume possible, but it means nothing is ever
 * collected unless we collect it.
 */

let counter = 0;

/**
 * A settable clock, injected rather than faked globally: `vi.useFakeTimers()`
 * stops the timers fake-indexeddb schedules its own callbacks on, so every
 * store call hangs until the test times out. The store takes its `now` as an
 * option for exactly this reason.
 */
function clock(iso: string) {
  let t = Date.parse(iso);
  return {
    now: () => t,
    set: (next: string) => {
      t = Date.parse(next);
    },
  };
}

function freshStore(userId?: string, now?: () => number): WafflebaseDocStore {
  counter += 1;
  return new WafflebaseDocStore({
    dbName: `wafflebase-cleanup-${counter}`,
    userId,
    now,
  });
}

/** Seeds one document with a snapshot and one logged change. */
async function seed(store: WafflebaseDocStore, key: string): Promise<void> {
  await store.saveSnapshot(key, new Uint8Array([1, 2, 3]));
  await store.appendChange(key, { clientSeq: 1, bytes: new Uint8Array([4]) });
}

describe("dropping a user's entries", () => {
  it("drops every entry that user wrote, and nothing else", async () => {
    // Logout on a shared machine. What makes this correct is the second half:
    // another account's envelope on the same device must survive, or logging
    // out of one account would destroy another's unsent work.
    const mine = freshStore("user-1");
    await seed(mine, "doc-a");
    await seed(mine, "doc-b");

    const theirs = new WafflebaseDocStore({
      dbName: mine.databaseName,
      userId: "user-2",
    });
    await seed(theirs, "doc-c");

    await mine.dropAllForUser("user-1");

    expect(await mine.load("doc-a")).toBeUndefined();
    expect(await mine.load("doc-b")).toBeUndefined();
    expect(await theirs.load("doc-c")).toBeDefined();
  });

  it("drops the change log with the snapshot, not just the snapshot", async () => {
    // An orphaned log is invisible to `load` and still occupies quota, so a
    // drop that leaves it behind looks complete and is not.
    const store = freshStore("user-1");
    await seed(store, "doc-a");

    await store.dropAllForUser("user-1");

    expect(await store.changeCount("doc-a")).toBe(0);
  });
});

describe("dropping one document", () => {
  it("purges the entry", async () => {
    // The document was deleted, or workspace access was lost. Either way the
    // content should not outlive the authority to read it.
    const store = freshStore("user-1");
    await seed(store, "doc-a");
    await seed(store, "doc-b");

    await store.purge("doc-a");

    expect(await store.load("doc-a")).toBeUndefined();
    expect(await store.load("doc-b")).toBeDefined();
  });
});

describe("collecting stale entries", () => {
  it("drops entries untouched for longer than the age, keeping the rest", async () => {
    const time = clock("2026-01-01T00:00:00Z");
    const store = freshStore("user-1", time.now);

    await seed(store, "old");

    time.set("2026-03-01T00:00:00Z");
    await seed(store, "recent");

    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const collected = await store.collectStale(thirtyDays);

    expect(collected).toBe(1);
    expect(await store.load("old")).toBeUndefined();
    expect(await store.load("recent")).toBeDefined();
  });

  it("counts an appended change as touching the entry", async () => {
    // Otherwise a document edited daily for a month is collected on its
    // anniversary with its unsent work still in the log, because only
    // `saveSnapshot` ever moved the clock.
    const time = clock("2026-01-01T00:00:00Z");
    const store = freshStore("user-1", time.now);

    await store.saveSnapshot("doc-a", new Uint8Array([1]));

    time.set("2026-03-01T00:00:00Z");
    await store.appendChange("doc-a", {
      clientSeq: 1,
      bytes: new Uint8Array([2]),
    });

    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(await store.collectStale(thirtyDays)).toBe(0);
    expect(await store.load("doc-a")).toBeDefined();
  });
});

describe("quota pressure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Makes the next `n` `put` calls fail the way a full origin does. Browsers
   * report this both ways — a synchronous throw and an aborted transaction — so
   * the store has to survive whichever it gets; this covers the throw.
   */
  function failPuts(n: number): void {
    const real = IDBObjectStore.prototype.put;
    let left = n;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      ...args: Array<unknown>
    ) {
      if (left > 0) {
        left -= 1;
        throw new DOMException("quota", "QuotaExceededError");
      }
      return (real as (...a: Array<unknown>) => IDBRequest).apply(this, args);
    } as typeof IDBObjectStore.prototype.put);
  }

  it("evicts the oldest entry and keeps the write that hit the wall", async () => {
    // The point of eviction is that the *new* write lands. A store that frees
    // space and then drops the write on the floor has spent the eviction and
    // lost the edit anyway.
    const time = clock("2026-01-01T00:00:00Z");
    const store = freshStore("user-1", time.now);

    await seed(store, "oldest");
    time.set("2026-02-01T00:00:00Z");
    await seed(store, "newer");
    time.set("2026-03-01T00:00:00Z");

    failPuts(1);
    await store.saveSnapshot("arriving", new Uint8Array([9, 9, 9]));

    expect(await store.load("oldest")).toBeUndefined();
    expect(await store.load("newer")).toBeDefined();
    const arrived = await store.load("arriving");
    expect(arrived).toBeDefined();
    expect(Array.from(arrived!.snapshot)).toEqual([9, 9, 9]);
  });

  it("gives up after one retry rather than evicting everything", async () => {
    // A store that never accepts a write must report undurable, not loop until
    // it has deleted every document the user had.
    const time = clock("2026-01-01T00:00:00Z");
    const store = freshStore("user-1", time.now);
    await seed(store, "oldest");
    time.set("2026-02-01T00:00:00Z");
    await seed(store, "keep-me");
    time.set("2026-03-01T00:00:00Z");

    failPuts(10);
    await expect(
      store.saveSnapshot("arriving", new Uint8Array([1])),
    ).rejects.toThrow(/quota/i);

    // Exactly one eviction was spent: the oldest went, the next one did not.
    expect(await store.load("oldest")).toBeUndefined();
    expect(await store.load("keep-me")).toBeDefined();
  });

  it("does not evict when the failure is not about quota", async () => {
    // Deleting a user's documents in response to an unrelated bug would be a
    // self-inflicted data loss.
    const store = freshStore("user-1");
    await seed(store, "keep-me");

    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("nope", "InvalidStateError");
    });

    await expect(
      store.saveSnapshot("arriving", new Uint8Array([1])),
    ).rejects.toThrow();
    vi.restoreAllMocks();

    expect(await store.load("keep-me")).toBeDefined();
  });
});
