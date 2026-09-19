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
 * Seeds a document the way a compaction leaves one: a snapshot and an empty
 * log.
 *
 * This is what an evictable entry looks like. `seed` leaves a change in the
 * log, and the log is the only thing the store can read that might be work the
 * server has not taken — so eviction spares it. Tests about the *mechanics* of
 * eviction (which entry, whose entry, how many times) seed this way so that
 * the thing they are asking about is the thing they measure.
 */
async function seedSynced(
  store: WafflebaseDocStore,
  key: string,
): Promise<void> {
  await store.saveSnapshot(key, new Uint8Array([1, 2, 3]));
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

  it("refuses a later append for an entry it dropped under a live client", async () => {
    // The erase is a promise about content, so unlike collection and eviction
    // it does not spare a document that happens to be open — the open one is
    // exactly the content the user is worried about. What it must not do is
    // fall silent: an append landing in nothing while the chip still says
    // "saved to this device" is the false promise this feature cannot make.
    const store = freshStore("user-1");
    await seed(store, "doc-live");

    await store.dropAllForUser("user-1");

    await expect(
      store.appendChange("doc-live", {
        clientSeq: 2,
        bytes: new Uint8Array([9]),
      }),
    ).rejects.toThrow();
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

  it("collects another account's stale entries and their stale archives", async () => {
    // A shared device's other account is the one that never comes back to run
    // its own housekeeping, so a user-scoped sweep leaves a departed user's
    // document content on the disk forever. The same policy at the same age is
    // therefore applied to every live entry, whoever wrote it.
    //
    // Archives are held to it too, and that is the half this used to get
    // wrong: an archive is a *whole document*, and exempting another account's
    // left it with no collection path at all — the session that ends by
    // expiring is the commonest way one ends on a shared machine, and that
    // account never signs back in to sweep. Deleting old content is not the
    // same authority as reading it: `listArchives` and `loadArchive` still
    // refuse to hand one account another's.
    const time = clock("2026-01-01T00:00:00Z");
    const mine = freshStore("user-1", time.now);
    await seed(mine, "mine-old");

    const theirs = new WafflebaseDocStore({
      dbName: mine.databaseName,
      userId: "user-2",
      now: time.now,
    });
    await seed(theirs, "theirs-old");
    await seed(theirs, "theirs-lost");
    theirs.expectLoss("theirs-lost");
    await theirs.remove("theirs-lost");

    time.set("2026-03-01T00:00:00Z");
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const later = reopen(mine, "user-1", time.now);

    // Two live entries and one archive, none of them this user's alone.
    expect(await later.collectStale(thirtyDays)).toBe(3);
    expect(await later.load("mine-old")).toBeUndefined();
    expect(await theirs.load("theirs-old")).toBeUndefined();
    expect(await theirs.listArchives()).toEqual([]);
  });

  it("spares another account's archive until it is old enough", async () => {
    // Age is the whole policy, and it is applied identically to everyone: a
    // recent archive is work its owner has not been offered back yet, whoever
    // they are.
    const time = clock("2026-01-01T00:00:00Z");
    const mine = freshStore("user-1", time.now);
    const theirs = new WafflebaseDocStore({
      dbName: mine.databaseName,
      userId: "user-2",
      now: time.now,
    });
    await seed(theirs, "theirs-lost");
    theirs.expectLoss("theirs-lost");
    await theirs.remove("theirs-lost");

    time.set("2026-01-10T00:00:00Z");
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const later = reopen(mine, "user-1", time.now);

    expect(await later.collectStale(thirtyDays)).toBe(0);
    expect(await theirs.listArchives()).toHaveLength(1);
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

  it("spares an entry holding work the server may not have", async () => {
    // The whole promise of the feature, against itself. Eviction frees space
    // by deleting a document outright — no archive, no warning — so an entry
    // with changes still in its log is the one thing it must not take: that
    // log is unsent work, and spending it to make room for another document's
    // unsent work is a trade nobody asked for and nobody is told about.
    //
    // The store cannot tell an acked change from an unacked one — that lives
    // in the SDK's own header — so a non-empty log counts as unsent. The cost
    // of being wrong that way is a refused write the chip reports honestly;
    // the cost of being wrong the other way is a document that silently is
    // not there any more.
    const time = clock("2026-01-01T00:00:00Z");
    const store = freshStore("user-1", time.now);

    await seed(store, "oldest-with-work");
    time.set("2026-02-01T00:00:00Z");
    await seedSynced(store, "newer-compacted");
    time.set("2026-03-01T00:00:00Z");

    const later = reopen(store, "user-1", time.now);
    failPuts(1);
    await later.saveSnapshot("arriving", new Uint8Array([9]));

    // Age said take the first one. Its log said otherwise.
    expect(await later.load("oldest-with-work")).toBeDefined();
    expect(await later.load("newer-compacted")).toBeUndefined();
    expect(await later.load("arriving")).toBeDefined();
  });

  it("refuses the write rather than evicting the last unsent copy", async () => {
    // With nothing free to take, the honest answer is that this device cannot
    // hold the document — which surfaces as an undurable store and a chip
    // that says so. Freeing space anyway would mean answering "saved" by
    // deleting something else the user believes is saved.
    const time = clock("2026-01-01T00:00:00Z");
    const store = freshStore("user-1", time.now);

    await seed(store, "the-only-one");
    time.set("2026-03-01T00:00:00Z");

    const later = reopen(store, "user-1", time.now);
    failPuts(1);
    await expect(
      later.saveSnapshot("arriving", new Uint8Array([9])),
    ).rejects.toThrow();

    expect(await later.load("the-only-one")).toBeDefined();
    expect((await later.load("the-only-one"))!.changes).toHaveLength(1);
  });

  it("evicts the oldest entry and keeps the write that hit the wall", async () => {
    // The point of eviction is that the *new* write lands. A store that frees
    // space and then drops the write on the floor has spent the eviction and
    // lost the edit anyway.
    const time = clock("2026-01-01T00:00:00Z");
    const store = freshStore("user-1", time.now);

    await seedSynced(store, "oldest");
    time.set("2026-02-01T00:00:00Z");
    await seedSynced(store, "newer");
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
    await seedSynced(theirs, "their-oldest");

    time.set("2026-02-01T00:00:00Z");
    const mine = new WafflebaseDocStore({
      dbName: theirs.databaseName,
      userId: "user-1",
      now: time.now,
    });
    await seedSynced(mine, "my-older");
    time.set("2026-03-01T00:00:00Z");
    await seedSynced(mine, "my-newer");

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
    await seedSynced(store, "oldest");
    time.set("2026-02-01T00:00:00Z");
    await seedSynced(store, "keep-me");
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
    await seedSynced(store, "only-doc");

    const later = reopen(store, "user-1");
    failPuts(1);
    await expect(
      later.appendChange("only-doc", {
        clientSeq: 2,
        bytes: new Uint8Array([5]),
      }),
    ).rejects.toThrow(/quota/i);
    vi.restoreAllMocks();

    // Still there, and the failure was reported. Seeded compacted on purpose:
    // an entry with a log would be spared by the log rule as well, and then
    // this case would pass without the exclusion it exists to prove.
    const stored = await later.load("only-doc");
    expect(stored).toBeDefined();
    expect(stored!.changes).toEqual([]);
  });

  it("never evicts a document this session has open, even the oldest one", async () => {
    // The dangerous shape is a document opened and not yet typed into: its
    // timestamp is from whenever it was last edited, so by age it is the
    // *first* eviction candidate — while the SDK holds it attached and will
    // keep appending into what eviction deleted. Ordering by age alone would
    // pick exactly the wrong entry here.
    const time = clock("2026-01-01T00:00:00Z");
    const previous = freshStore("user-1", time.now);
    await seedSynced(previous, "opened-but-idle");
    time.set("2026-02-01T00:00:00Z");
    await seedSynced(previous, "truly-idle");

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
    await seedSynced(store, "victim");

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
    await seedSynced(seeder, "open-in-tab-a");

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

  it("asks the cross-account guard before collecting another account's entry", async () => {
    // The sweep is deliberately cross-account — a departed user's entries are
    // the ones no session of theirs will ever come back for — so the guard
    // that spares an open document has to reach as far. The account-scoped
    // question every other caller asks answers "not mine, therefore idle",
    // and collecting it makes that tab's later appends silently vanish.
    const time = clock("2026-01-01T00:00:00Z");
    const seeder = freshStore("user-2", time.now);
    await seed(seeder, "theirs-and-open");

    time.set("2026-06-01T00:00:00Z");
    const sweeper = new WafflebaseDocStore({
      dbName: seeder.databaseName,
      userId: "user-1",
      now: time.now,
      // What a user-scoped guard answers about somebody else's document.
      isOpenElsewhere: () => false,
      isOpenForAnyUser: openSet(new Set(["theirs-and-open"])),
    });

    expect(await sweeper.collectStale(30 * 24 * 60 * 60 * 1000)).toBe(0);
    expect(await sweeper.load("theirs-and-open")).toBeDefined();
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

describe("telling the app the writes are not landing", () => {
  it("reports a write that failed for any reason", async () => {
    // The chip's `saved-locally` is a promise that the work is on disk, and
    // the SDK swallows store failures — so without this a store that accepts
    // nothing still reads as durable.
    const failures: Array<unknown> = [];
    counter += 1;
    const store = new WafflebaseDocStore({
      dbName: `wafflebase-cleanup-${counter}`,
      userId: "user-1",
      onWriteFailure: (err) => failures.push(err),
    });

    const real = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
    ) {
      throw new DOMException("refused", "InvalidStateError");
    } as typeof IDBObjectStore.prototype.put);

    await expect(
      store.saveSnapshot("doc-a", new Uint8Array([1])),
    ).rejects.toThrow();
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(real);

    expect(failures).toHaveLength(1);
  });

  it("reports a full origin that eviction could not relieve", async () => {
    const failures: Array<unknown> = [];
    counter += 1;
    const store = new WafflebaseDocStore({
      dbName: `wafflebase-cleanup-${counter}`,
      userId: "user-1",
      onWriteFailure: (err) => failures.push(err),
    });

    // Nothing idle to free, so the retry never happens.
    failPuts(1);
    await expect(
      store.saveSnapshot("doc-a", new Uint8Array([1])),
    ).rejects.toThrow();
    vi.restoreAllMocks();

    expect(failures).toHaveLength(1);
  });

  it("says nothing while the writes are landing", async () => {
    const failures: Array<unknown> = [];
    counter += 1;
    const store = new WafflebaseDocStore({
      dbName: `wafflebase-cleanup-${counter}`,
      userId: "user-1",
      onWriteFailure: (err) => failures.push(err),
    });

    await seed(store, "doc-a");

    expect(failures).toEqual([]);
  });
});

describe("an erase under a live client", () => {
  it("refuses the append on the instance the SDK is writing through", async () => {
    // The instance that erases is never the instance the client holds: the
    // housekeeping runtime has its own store. Marking the key per instance put
    // the refusal where no append would ever read it, so appends after an
    // erase were silently ignored while the chip still said "saved".
    const client = freshStore("user-1");
    await seed(client, "doc-live");

    const housekeeping = reopen(client, "user-1");
    await housekeeping.dropAllForUser("user-1");

    await expect(
      client.appendChange("doc-live", {
        clientSeq: 2,
        bytes: new Uint8Array([9]),
      }),
    ).rejects.toThrow(/evicted/i);
  });
});

describe("losing access rather than losing the document", () => {
  it("takes the archives too when access is what was lost", async () => {
    // Recovery re-materializes a whole document from an archive, so one that
    // survives a revoked membership is a permanent copy of content the user
    // may no longer read.
    const store = freshStore("user-1");
    await seed(store, "pk/wb:1:sheet-abc/sheet-abc");
    store.expectLoss("pk/wb:1:sheet-abc/sheet-abc");
    await store.remove("pk/wb:1:sheet-abc/sheet-abc");
    expect(await store.listArchives()).toHaveLength(1);

    await store.purgeDocument("abc", { archives: "drop" });

    expect(await store.listArchives()).toEqual([]);
  });

  it("keeps them when the document was merely deleted", async () => {
    const store = freshStore("user-1");
    await seed(store, "sheet-abc");
    store.expectLoss("sheet-abc");
    await store.remove("sheet-abc");

    await store.purgeDocument("abc");

    expect(await store.listArchives()).toHaveLength(1);
  });

  it("never drops another account's archive for the same document", async () => {
    const mine = freshStore("user-1");
    const theirs = new WafflebaseDocStore({
      dbName: mine.databaseName,
      userId: "user-2",
    });
    await seed(theirs, "sheet-abc");
    theirs.expectLoss("sheet-abc");
    await theirs.remove("sheet-abc");

    await mine.purgeDocument("abc", { archives: "drop" });

    expect(await theirs.listArchives()).toHaveLength(1);
  });

  it("spares a document a client has open right now when asked to", async () => {
    // The revocation reconcile deletes on an *absence* from a listing taken a
    // moment ago, over a database shared with this user's other tabs — so a
    // document open in one of them is not evidence of anything. Purging it is
    // the same silent-append loss eviction is careful to avoid, with no quota
    // failure needed to cause it.
    const open = new Set(["pk/wb:1:sheet-abc/sheet-abc"]);
    const store = new WafflebaseDocStore({
      dbName: `wafflebase-reconcile-open`,
      userId: "user-1",
      isOpenElsewhere: (docKey) => open.has(docKey),
    });
    await seed(store, "pk/wb:1:sheet-abc/sheet-abc");

    expect(
      await store.purgeDocument("abc", { archives: "drop", skipOpen: true }),
    ).toBe(0);
    expect(await store.load("pk/wb:1:sheet-abc/sheet-abc")).toBeDefined();
  });

  it("spares an entry written after the listing it is being judged against", async () => {
    // A document another tab created while `GET /documents` was in flight is
    // missing from the answer for no reason at all.
    const time = clock("2026-01-01T00:00:00Z");
    const store = new WafflebaseDocStore({
      dbName: `wafflebase-reconcile-fresh`,
      userId: "user-1",
      now: time.now,
    });
    const listedAt = time.now();
    time.set("2026-01-01T00:00:01Z");
    await seed(store, "sheet-new");

    expect(
      await store.purgeDocument("new", { updatedSince: listedAt }),
    ).toBe(0);
    expect(await store.load("sheet-new")).toBeDefined();

    // And the same entry goes once the listing is the newer fact.
    expect(
      await store.purgeDocument("new", { updatedSince: time.now() + 1 }),
    ).toBe(1);
  });

  it("makes a reconcile's deletion loud rather than silent", async () => {
    // `purge` alone neither checks liveness nor marks the key, so an append
    // for it was taken for the contract's "no base" success — every later edit
    // going nowhere while the chip still said the document was saved.
    const client = freshStore("user-1");
    await seed(client, "sheet-gone");

    const housekeeping = reopen(client, "user-1");
    await housekeeping.purgeDocument("gone", { archives: "drop" });

    await expect(
      client.appendChange("sheet-gone", {
        clientSeq: 2,
        bytes: new Uint8Array([9]),
      }),
    ).rejects.toThrow(/evicted/i);
  });

  it("lists the document ids it holds, so the app can ask what is still readable", async () => {
    const store = freshStore("user-1");
    await seed(store, "pk/wb:1:sheet-abc/sheet-abc");
    await seed(store, "pk/wb:1:doc-xyz/doc-xyz");

    expect((await store.storedDocumentIds()).sort()).toEqual(["abc", "xyz"]);
  });
});

describe("after offline saving is switched off", () => {
  it("refuses to write the open document back to the disk it just cleared", async () => {
    // The durable client is deliberately not torn down when the preference
    // flips — re-deciding durability would unmount the editor and take the
    // queue at risk with it — so it outlives the erase. Without a refusal its
    // next write puts the open document straight back, and nothing runs again
    // to remove it.
    let enabled = true;
    const client = new WafflebaseDocStore({
      dbName: "wafflebase-disabled-1",
      userId: "user-1",
      isPersistenceEnabled: () => enabled,
    });
    await seed(client, "sheet-open");

    const housekeeping = reopen(client, "user-1");
    enabled = false;
    await housekeeping.dropAllForUser("user-1");

    await expect(
      client.saveSnapshot("sheet-open", new Uint8Array([7])),
    ).rejects.toThrow(/switched off/i);
    await expect(
      client.appendChange("sheet-open", {
        clientSeq: 9,
        bytes: new Uint8Array([7]),
      }),
    ).rejects.toThrow(/switched off/i);
    await expect(
      client.saveMeta("sheet-open", new Uint8Array([7])),
    ).rejects.toThrow(/switched off/i);

    expect(await housekeeping.load("sheet-open")).toBeUndefined();
  });

  it("tells the chip, so it stops promising the document is on disk", async () => {
    // A refusal the chip cannot see would read as `Saved to this device` for a
    // document nothing is saving.
    const failures: Array<unknown> = [];
    const store = new WafflebaseDocStore({
      dbName: "wafflebase-disabled-2",
      userId: "user-1",
      isPersistenceEnabled: () => false,
      onWriteFailure: (err) => failures.push(err),
    });

    await expect(
      store.saveSnapshot("sheet-a", new Uint8Array([1])),
    ).rejects.toThrow();
    expect(failures).toHaveLength(1);
  });

  it("writes as usual while it is still on", async () => {
    const store = new WafflebaseDocStore({
      dbName: "wafflebase-disabled-3",
      userId: "user-1",
      isPersistenceEnabled: () => true,
    });
    await seed(store, "sheet-a");
    expect(await store.load("sheet-a")).toBeDefined();
  });
});

describe("collecting under a live client", () => {
  it("marks what it collected, so a later append cannot vanish", async () => {
    // `isLive` is a best answer, not a proof: a client can attach between the
    // question and the delete, and the sweeping instance is routinely not the
    // one the SDK writes through. Every other delete-under-a-live-client path
    // marks the key for exactly that reason — without it the SDK's next append
    // finds no header and takes the contract's silent "no base" success, so
    // every later edit goes nowhere while the chip still reports the document
    // saved to this device.
    const time = clock("2026-01-01T00:00:00Z");
    // Two instances over one database, which is the real arrangement: the
    // sweep runs from the housekeeping runtime's store while the SDK writes
    // through the durable client's.
    const client = freshStore("user-1", time.now);
    const housekeeping = new WafflebaseDocStore({
      dbName: client.databaseName,
      userId: "user-1",
      now: () => Date.parse("2026-03-01T00:00:00Z"),
    });
    await seed(client, "sheet-a");

    expect(await housekeeping.collectStale()).toBeGreaterThan(0);

    await expect(
      client.appendChange("sheet-a", {
        clientSeq: 2,
        bytes: new Uint8Array([9]),
      }),
    ).rejects.toThrow(/evicted/i);
  });
});

describe("purging a document's archives", () => {
  it("spares an archive written after the caller's listing was taken", async () => {
    // `skipOpen`/`updatedSince` exist for the one caller that deletes on an
    // absence rather than on an answer — the once-per-session reconcile. An
    // archive another tab wrote after the listing is missing from that listing
    // for no reason at all, and it is by this feature's own design the only
    // copy of work the server never took.
    const time = clock("2026-01-01T00:00:00Z");
    const store = freshStore("user-1", time.now);
    await seed(store, "sheet-a");
    store.expectLoss("sheet-a");
    await store.remove("sheet-a");
    expect(await store.listArchives()).toHaveLength(1);

    // The listing was asked for before the archive existed.
    await store.purgeDocument("a", {
      archives: "drop",
      skipOpen: true,
      updatedSince: Date.parse("2025-12-31T00:00:00Z"),
    });
    expect(await store.listArchives()).toHaveLength(1);

    // And an archive that predates the listing still goes.
    await store.purgeDocument("a", {
      archives: "drop",
      skipOpen: true,
      updatedSince: Date.parse("2026-02-01T00:00:00Z"),
    });
    expect(await store.listArchives()).toHaveLength(0);
  });

  it("spares an archive whose document a tab has open", async () => {
    const time = clock("2026-01-01T00:00:00Z");
    counter += 1;
    const store = new WafflebaseDocStore({
      dbName: `wafflebase-cleanup-${counter}`,
      userId: "user-1",
      now: time.now,
      isOpenElsewhere: () => true,
    });
    await seed(store, "sheet-a");
    store.expectLoss("sheet-a");
    await store.remove("sheet-a");

    await store.purgeDocument("a", { archives: "drop", skipOpen: true });
    expect(await store.listArchives()).toHaveLength(1);
  });

  it("still drops unconditionally for a caller that knows the document is gone", async () => {
    // A delete the server accepted passes neither guard and keeps today's
    // behavior.
    const store = freshStore("user-1");
    await seed(store, "sheet-a");
    store.expectLoss("sheet-a");
    await store.remove("sheet-a");

    await store.purgeDocument("a", { archives: "drop" });
    expect(await store.listArchives()).toHaveLength(0);
  });
});
