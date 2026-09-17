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

function freshStore(userId: string, now?: () => number): WafflebaseDocStore {
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

/**
 * A second store over the same database — a later session.
 *
 * Collection and eviction deliberately spare whatever the *current* session is
 * persisting, so a test that seeds and collects through one instance is asking
 * about a case that cannot arise: the entries it wants collected are the ones
 * it just wrote. Reopening is what a new page load does, and it is when old
 * entries actually become collectable.
 */
function reopen(
  store: WafflebaseDocStore,
  userId: string,
  now?: () => number,
): WafflebaseDocStore {
  return new WafflebaseDocStore({ dbName: store.databaseName, userId, now });
}

/**
 * Makes the next `n` `put` calls fail the way a full origin does. Browsers
 * report this both ways — a synchronous throw and an aborted transaction — so
 * the store has to survive whichever it gets; this covers the throw.
 * `-robustness.test.ts` covers the abort.
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
    const later = reopen(store, "user-1", time.now);
    const collected = await later.collectStale(thirtyDays);

    expect(collected).toBe(1);
    expect(await later.load("old")).toBeUndefined();
    expect(await later.load("recent")).toBeDefined();
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
    const later = reopen(store, "user-1", time.now);
    expect(await later.collectStale(thirtyDays)).toBe(0);
    expect(await later.load("doc-a")).toBeDefined();
  });
});

describe("quota pressure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

    // A later session: neither seeded document is one this store is
    // persisting, so both are eligible and the oldest goes.
    const later = reopen(store, "user-1", time.now);
    failPuts(1);
    await later.saveSnapshot("arriving", new Uint8Array([9, 9, 9]));

    expect(await later.load("oldest")).toBeUndefined();
    expect(await later.load("newer")).toBeDefined();
    const arrived = await later.load("arriving");
    expect(arrived).toBeDefined();
    expect(Array.from(arrived!.snapshot)).toEqual([9, 9, 9]);
  });

  it("never evicts another account's entry on a shared device", async () => {
    // The database is per origin and the `updatedAt` index spans every row in
    // it, so an unscoped scan makes one person's edit delete the other's
    // unsent work — on the one kind of machine this whole feature is careful
    // about.
    const time = clock("2026-01-01T00:00:00Z");
    const theirs = freshStore("user-2", time.now);
    await seed(theirs, "their-oldest");

    time.set("2026-02-01T00:00:00Z");
    const mine = new WafflebaseDocStore({
      dbName: theirs.databaseName,
      userId: "user-1",
      now: time.now,
    });
    await seed(mine, "my-older");
    time.set("2026-03-01T00:00:00Z");
    await seed(mine, "my-newer");

    time.set("2026-04-01T00:00:00Z");
    const later = reopen(mine, "user-1", time.now);
    failPuts(1);
    await later.saveSnapshot("arriving", new Uint8Array([9]));

    // The other account's document — the oldest row in the whole database —
    // is untouched, and the eviction came out of this user's own entries.
    const theirReader = reopen(theirs, "user-2", time.now);
    expect(await theirReader.load("their-oldest")).toBeDefined();
    expect(await later.load("my-older")).toBeUndefined();
    expect(await later.load("my-newer")).toBeDefined();
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

    const later = reopen(store, "user-1", time.now);
    failPuts(10);
    await expect(
      later.saveSnapshot("arriving", new Uint8Array([1])),
    ).rejects.toThrow(/quota/i);

    // Exactly one eviction was spent: the oldest went, the next one did not.
    expect(await later.load("oldest")).toBeUndefined();
    expect(await later.load("keep-me")).toBeDefined();
  });

  it("does not evict when the failure is not about quota", async () => {
    // Deleting a user's documents in response to an unrelated bug would be a
    // self-inflicted data loss.
    const store = freshStore("user-1");
    await seed(store, "keep-me");
    const later = reopen(store, "user-1");

    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("nope", "InvalidStateError");
    });

    await expect(
      later.saveSnapshot("arriving", new Uint8Array([1])),
    ).rejects.toThrow();
    vi.restoreAllMocks();

    expect(await later.load("keep-me")).toBeDefined();
  });

  it("never evicts the document it is writing", async () => {
    // With one document stored, the globally oldest entry IS the one under
    // the failing write. Evicting it makes the retry write into nothing, and
    // then — because an append with no base is contractually ignored — the
    // call resolves as a success with the snapshot, the log and the document
    // all gone. Reproduced exactly this way before the exclusion existed.
    const store = freshStore("user-1");
    await seed(store, "only-doc");

    const later = reopen(store, "user-1");
    failPuts(1);
    await expect(
      later.appendChange("only-doc", {
        clientSeq: 2,
        bytes: new Uint8Array([5]),
      }),
    ).rejects.toThrow(/quota/i);
    vi.restoreAllMocks();

    // Still there, with its log, and the failure was reported.
    const stored = await later.load("only-doc");
    expect(stored).toBeDefined();
    expect(stored!.changes.map((c) => c.clientSeq)).toEqual([1]);
  });

  it("never evicts a document this session has open, even the oldest one", async () => {
    // The dangerous shape is a document opened and not yet typed into: its
    // timestamp is from whenever it was last edited, so by age it is the
    // *first* eviction candidate — while the SDK holds it attached and will
    // keep appending into what eviction deleted. Ordering by age alone would
    // pick exactly the wrong entry here.
    const time = clock("2026-01-01T00:00:00Z");
    const previous = freshStore("user-1", time.now);
    await seed(previous, "opened-but-idle");
    time.set("2026-02-01T00:00:00Z");
    await seed(previous, "truly-idle");

    time.set("2026-03-01T00:00:00Z");
    const session = reopen(previous, "user-1", time.now);
    // The editor attaches: the SDK loads before it ever writes.
    expect(await session.load("opened-but-idle")).toBeDefined();

    failPuts(1);
    await session.saveSnapshot("arriving", new Uint8Array([1]));
    vi.restoreAllMocks();

    // The newer but genuinely idle entry paid for it; the open one survived
    // despite being older.
    expect(await session.load("truly-idle")).toBeUndefined();
    expect(await session.load("opened-but-idle")).toBeDefined();
  });

  it("fails an append for a key eviction took, rather than ignoring it", async () => {
    // An append with no base is contractually a silent success, because the
    // SDK repairs a base it knows it failed to write. It does not know about
    // one we deleted behind its back, so silence there would let it hand us
    // edits that go nowhere. The rejection is what makes it poison the log and
    // write a fresh snapshot.
    const time = clock("2026-01-01T00:00:00Z");
    const store = freshStore("user-1", time.now);
    await seed(store, "victim");

    time.set("2026-02-01T00:00:00Z");
    const session = reopen(store, "user-1", time.now);
    failPuts(1);
    await session.saveSnapshot("arriving", new Uint8Array([1]));
    vi.restoreAllMocks();
    expect(await session.load("victim")).toBeUndefined();

    await expect(
      session.appendChange("victim", {
        clientSeq: 9,
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toThrow(/evicted/i);

    // And a fresh base clears it: the SDK repaired, so appends work again.
    await session.saveSnapshot("victim", new Uint8Array([2]));
    await session.appendChange("victim", {
      clientSeq: 1,
      bytes: new Uint8Array([3]),
    });
    expect(await session.changeCount("victim")).toBe(1);
  });
});

describe("collection and live documents", () => {
  it("leaves a document this session has open alone, however old it is", async () => {
    // Purging an entry out from under a live SDK client is the same silent
    // loss eviction has to avoid: the client keeps appending into nothing.
    const time = clock("2026-01-01T00:00:00Z");
    const store = freshStore("user-1", time.now);
    await store.saveSnapshot("open-now", new Uint8Array([1]));

    // Two months pass with the tab open and no edit — plausible for a
    // document left on screen.
    time.set("2026-03-01T00:00:00Z");
    expect(await store.collectStale(30 * 24 * 60 * 60 * 1000)).toBe(0);
    expect(await store.load("open-now")).toBeDefined();
  });
});

describe("documents open in another tab", () => {
  /** What the app supplies: "is this document open anywhere right now?" */
  function openSet(keys: Set<string>) {
    return (docKey: string) => keys.has(docKey);
  }

  it("does not evict a document another instance has open", async () => {
    // Two tabs on *different* documents are both durable over one database,
    // and each store instance knows only what it has touched itself. Without a
    // shared answer, tab B's eviction deletes tab A's open document, and A's
    // appends then look like the contract's silent "no base" success — every
    // edit after that goes nowhere while the chip reports it saved.
    const time = clock("2026-01-01T00:00:00Z");
    const seeder = freshStore("user-1", time.now);
    await seed(seeder, "open-in-tab-a");

    const openElsewhere = new Set(["open-in-tab-a"]);
    time.set("2026-02-01T00:00:00Z");
    const tabB = new WafflebaseDocStore({
      dbName: seeder.databaseName,
      userId: "user-1",
      now: time.now,
      isOpenElsewhere: openSet(openElsewhere),
    });

    failPuts(1);
    await expect(
      tabB.saveSnapshot("tab-b-doc", new Uint8Array([1])),
    ).rejects.toThrow(/quota/i);
    vi.restoreAllMocks();

    // Nothing was free to take, so the write failed honestly instead of
    // buying space with another tab's document.
    expect(await tabB.load("open-in-tab-a")).toBeDefined();
  });

  it("does not collect a document another instance has open", async () => {
    // This one needs no quota failure at all: the periodic sweep, run from any
    // instance that is not the one holding the document.
    const time = clock("2026-01-01T00:00:00Z");
    const seeder = freshStore("user-1", time.now);
    await seed(seeder, "open-in-tab-a");

    time.set("2026-06-01T00:00:00Z");
    const sweeper = new WafflebaseDocStore({
      dbName: seeder.databaseName,
      userId: "user-1",
      now: time.now,
      isOpenElsewhere: openSet(new Set(["open-in-tab-a"])),
    });

    expect(await sweeper.collectStale(30 * 24 * 60 * 60 * 1000)).toBe(0);
    expect(await sweeper.load("open-in-tab-a")).toBeDefined();
  });

  it("collects it once no tab has it open", async () => {
    const time = clock("2026-01-01T00:00:00Z");
    const seeder = freshStore("user-1", time.now);
    await seed(seeder, "was-open");

    time.set("2026-06-01T00:00:00Z");
    const sweeper = new WafflebaseDocStore({
      dbName: seeder.databaseName,
      userId: "user-1",
      now: time.now,
      isOpenElsewhere: () => false,
    });

    expect(await sweeper.collectStale(30 * 24 * 60 * 60 * 1000)).toBe(1);
    expect(await sweeper.load("was-open")).toBeUndefined();
  });
});
