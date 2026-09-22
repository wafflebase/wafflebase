import "fake-indexeddb/auto";
import { describe, it, expect, vi, afterEach } from "vitest";
import { WafflebaseDocStore } from "./wafflebase-doc-store";

/**
 * A write either happens or it does not.
 *
 * Each method issues several requests into one transaction and then awaits its
 * commit. If a request after the first throws, an `async` function unwinds
 * *without aborting the transaction* — and IndexedDB commits whatever was
 * already issued. The caller sees a rejection that says "quota" while the entry
 * is left in a state no code path expects.
 */

let counter = 0;

function freshStore(dbName?: string): WafflebaseDocStore {
  counter += 1;
  return new WafflebaseDocStore({
    dbName: dbName ?? `wafflebase-atomic-${counter}`,
    userId: "user-1",
  });
}

/**
 * Fails `put` for one named object store. The existing quota tests fail the
 * *first* put, where the throw happens before anything is issued and is
 * therefore harmless; the damage lives in a failure on a later request in the
 * same transaction.
 */
function failPutOn(storeName: string): void {
  const real = IDBObjectStore.prototype.put;
  let fired = false;
  vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
    this: IDBObjectStore,
    ...args: Array<unknown>
  ) {
    if (!fired && this.name === storeName) {
      fired = true;
      throw new DOMException("quota", "QuotaExceededError");
    }
    return (real as (...a: Array<unknown>) => IDBRequest).apply(this, args);
  } as typeof IDBObjectStore.prototype.put);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a compaction that fails part way", () => {
  it("leaves the old entry whole rather than a snapshot over a stale log", async () => {
    // `saveSnapshot` advances the snapshot and drops the log and meta, because
    // the new snapshot already contains them. Committing the first half alone
    // leaves a snapshot with a delta already folded into it — replay then
    // applies those operations a second time.
    const store = freshStore();
    await store.saveSnapshot("doc-a", new Uint8Array([1]));
    await store.appendChange("doc-a", {
      clientSeq: 1,
      bytes: new Uint8Array([2]),
    });
    await store.saveMeta("doc-a", new Uint8Array([5]));

    failPutOn("headers");
    await expect(
      store.saveSnapshot("doc-a", new Uint8Array([9])),
    ).rejects.toThrow();
    vi.restoreAllMocks();

    // The write was refused, so none of it happened: the entry is exactly what
    // it was, log and header included. Accepting "either outcome" here would
    // let a committed replacement pass as a rollback, which is the failure
    // this case exists to catch.
    const stored = await store.load("doc-a");
    expect(Array.from(stored!.snapshot)).toEqual([1]);
    expect(stored!.changes.map((c) => c.clientSeq)).toEqual([1]);
    expect(Array.from(stored!.changes[0].bytes)).toEqual([2]);
    expect(Array.from(stored!.meta!)).toEqual([5]);
  });

  it("writes no half-entry that load reports as present", async () => {
    // A snapshot row with no header is the worst shape the split can produce:
    // `load` keys on the snapshot and says the document exists, while
    // `appendChange` keys on the header and silently discards every edit for
    // the life of the key — and no cleanup path walks snapshots, so it can
    // never be collected and survives logout.
    const store = freshStore();

    failPutOn("headers");
    await expect(
      store.saveSnapshot("doc-a", new Uint8Array([1, 2, 3])),
    ).rejects.toThrow();
    vi.restoreAllMocks();

    expect(await store.load("doc-a")).toBeUndefined();

    // And the key is usable afterwards, rather than permanently deaf.
    await store.saveSnapshot("doc-a", new Uint8Array([7]));
    await store.appendChange("doc-a", {
      clientSeq: 1,
      bytes: new Uint8Array([8]),
    });
    expect(await store.changeCount("doc-a")).toBe(1);
  });
});

describe("an entry that predates the header rule", () => {
  it("is collected rather than living forever out of reach", async () => {
    // Belt and braces for the shape above: whatever produced a snapshot with
    // no header — a torn write, a rollback, a future schema mistake — cleanup
    // has to be able to reach it, or it is a permanent quota leak holding
    // document content that logout cannot erase.
    const store = freshStore();
    await store.saveSnapshot("doc-a", new Uint8Array([1]));

    // Reach in and remove the header, leaving the snapshot behind.
    const db = await (
      store as unknown as { open: () => Promise<IDBDatabase> }
    ).open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("headers", "readwrite");
      tx.objectStore("headers").delete("doc-a");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    expect(await store.collectStale(0)).toBeGreaterThan(0);
    expect(await store.load("doc-a")).toBeUndefined();
  });
});

describe("a removal that fails part way", () => {
  it("deletes nothing when the archive could not be written", async () => {
    // The deletes and the archive `put` go into one transaction precisely so
    // this cannot happen: committing the deletes alone would destroy the only
    // copy of work the SDK has already given up on, which is the single worst
    // outcome available to this store.
    const store = freshStore();
    await store.saveSnapshot("doc-a", new Uint8Array([1]));
    await store.appendChange("doc-a", {
      clientSeq: 1,
      bytes: new Uint8Array([2]),
    });

    store.expectLoss("doc-a");
    failPutOn("archives");
    await expect(store.remove("doc-a")).rejects.toThrow();
    vi.restoreAllMocks();

    const stored = await store.load("doc-a");
    expect(stored).toBeDefined();
    expect(stored!.changes.map((c) => c.clientSeq)).toEqual([1]);
    expect(await store.listArchives()).toEqual([]);
  });

  it("keeps the loss latch, so the retry still archives", async () => {
    // The latch is the only thing that makes a removal an archive rather than
    // a delete. Spending it before the commit turns a failed removal into a
    // silent downgrade: the retry finds no latch and deletes outright.
    const store = freshStore();
    await store.saveSnapshot("doc-a", new Uint8Array([1]));

    store.expectLoss("doc-a");
    failPutOn("archives");
    await expect(store.remove("doc-a")).rejects.toThrow();
    vi.restoreAllMocks();

    await store.remove("doc-a");

    expect((await store.listArchives()).map((a) => a.docKey)).toEqual([
      "doc-a",
    ]);
    expect(await store.load("doc-a")).toBeUndefined();
  });

  it("spends the latch once the removal has committed", async () => {
    // The other half: a document removed as a loss and then opened, edited and
    // closed normally must not archive a second time. Archiving every close is
    // what makes the archive mean "everything you ever closed".
    const store = freshStore();
    await store.saveSnapshot("doc-a", new Uint8Array([1]));
    store.expectLoss("doc-a");
    await store.remove("doc-a");

    await store.saveSnapshot("doc-a", new Uint8Array([2]));
    await store.remove("doc-a");

    expect(await store.listArchives()).toHaveLength(1);
  });
});
