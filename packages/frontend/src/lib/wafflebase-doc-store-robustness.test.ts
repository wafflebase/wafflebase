import "fake-indexeddb/auto";
import { describe, it, expect, vi, afterEach } from "vitest";
import { WafflebaseDocStore } from "./wafflebase-doc-store";

/**
 * Properties the transcribed contract cannot carry.
 *
 * `doc-store-contract.ts` is a copy of the SDK's suite and stays a copy —
 * strengthening it would be the drift it exists to prevent. But two of its
 * cases are satisfiable without doing the thing they name, because they assert
 * through `load`, which answers on the snapshot row alone:
 *
 * - "ignores an append for a key with no entry" passes even if the append
 *   writes an orphan change row, which `load` cannot see and quota can.
 * - "clears snapshot, meta and log on remove" passes if only the snapshot goes.
 *
 * `changeCount` is ours, not the SDK's, so the stronger assertions live here.
 * The rest of this file covers failure modes the contract has no opinion about.
 */

let counter = 0;

function freshStore(dbName?: string): WafflebaseDocStore {
  counter += 1;
  return new WafflebaseDocStore({
    dbName: dbName ?? `wafflebase-robust-${counter}`,
    userId: "user-1",
  });
}

describe("what the contract asserts only through load", () => {
  it("writes no orphan change row when the base is absent", async () => {
    const store = freshStore();
    await store.appendChange("ghost", {
      clientSeq: 1,
      bytes: new Uint8Array([1]),
    });

    expect(await store.load("ghost")).toBeUndefined();
    // The half `load` cannot see: a row here is invisible and still billed.
    expect(await store.changeCount("ghost")).toBe(0);
  });

  it("clears the log on remove, not only the snapshot", async () => {
    const store = freshStore();
    await store.saveSnapshot("doc-a", new Uint8Array([1]));
    await store.appendChange("doc-a", {
      clientSeq: 1,
      bytes: new Uint8Array([2]),
    });

    await store.remove("doc-a");

    expect(await store.load("doc-a")).toBeUndefined();
    expect(await store.changeCount("doc-a")).toBe(0);
  });
});

describe("quota reported as an aborted transaction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("evicts and retries when the write fails by abort, not by throwing", async () => {
    // Chrome reports a full origin by aborting the transaction with a
    // QuotaExceededError, not by throwing from `put`. That reaches the retry
    // through a different path — `completed(tx)` rejecting with `tx.error` —
    // and it is the form production will actually hit.
    const store = freshStore();
    await store.saveSnapshot("from-last-week", new Uint8Array([1]));

    const session = new WafflebaseDocStore({
      dbName: store.databaseName,
      userId: "user-1",
    });

    const realPut = IDBObjectStore.prototype.put;
    let abortNext = true;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      ...args: Array<unknown>
    ) {
      const request = (realPut as (...a: Array<unknown>) => IDBRequest).apply(
        this,
        args,
      );
      if (abortNext) {
        abortNext = false;
        const tx = this.transaction;
        // Aborted in a microtask, not inline: the store issues the rest of its
        // requests in the same synchronous block, and killing the transaction
        // underneath them would raise InvalidStateError instead of reproducing
        // a full origin. Stamped with the quota name the store keys on, the
        // way a real one arrives.
        queueMicrotask(() => {
          Object.defineProperty(tx, "error", {
            configurable: true,
            get: () => new DOMException("quota", "QuotaExceededError"),
          });
          tx.abort();
        });
      }
      return request;
    } as typeof IDBObjectStore.prototype.put);

    await session.saveSnapshot("arriving", new Uint8Array([9]));
    vi.restoreAllMocks();

    // The idle entry paid for the space and the write landed.
    expect(await session.load("from-last-week")).toBeUndefined();
    expect(Array.from((await session.load("arriving"))!.snapshot)).toEqual([9]);
  });
});

describe("opening the database", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("recovers after a transient open failure", async () => {
    // The open promise is memoized so concurrent callers share one open. If a
    // rejection were memoized with it, a single glitch — a storage permission
    // the user grants a moment later, a briefly locked profile — would brick
    // the store for the whole session, every later call rejecting with the
    // same stale error. For a feature the user just switched on, that reads as
    // "it never worked".
    const store = freshStore();

    const realOpen = indexedDB.open.bind(indexedDB);
    let failOnce = true;
    vi.spyOn(indexedDB, "open").mockImplementation((...args) => {
      if (failOnce) {
        failOnce = false;
        // A request that only ever errors. Returning a real one for a scratch
        // database does not work: it succeeds first, and the store resolves
        // before the injected failure ever arrives.
        const request = {
          error: new DOMException("denied", "UnknownError"),
          result: undefined,
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
          onblocked: null,
        } as unknown as IDBOpenDBRequest;
        setTimeout(() => request.onerror?.(new Event("error") as never), 0);
        return request;
      }
      return realOpen(...(args as Parameters<typeof realOpen>));
    });

    await expect(store.load("doc-a")).rejects.toBeTruthy();

    // The next call must open for itself rather than replay the rejection.
    vi.restoreAllMocks();
    await store.saveSnapshot("doc-a", new Uint8Array([1]));
    expect(await store.load("doc-a")).toBeDefined();
  });
});

describe("overlapping calls", () => {
  it("keeps every change when appends are issued without awaiting", async () => {
    // The SDK chains its writes per key, but nothing in this store's contract
    // promises that, and a lost or duplicated entry is unrecoverable. Issue
    // them all at once and check the log is exactly what was handed over.
    const store = freshStore();
    await store.saveSnapshot("doc-a", new Uint8Array([0]));

    await Promise.all(
      [1, 2, 3, 4, 5].map((clientSeq) =>
        store.appendChange("doc-a", {
          clientSeq,
          bytes: new Uint8Array([clientSeq]),
        }),
      ),
    );

    const stored = await store.load("doc-a");
    expect(stored!.changes.map((c) => c.clientSeq)).toEqual([1, 2, 3, 4, 5]);
    expect(stored!.changes.map((c) => c.bytes[0])).toEqual([1, 2, 3, 4, 5]);
  });

  it("does not resurrect a dropped log when a snapshot races appends", async () => {
    // `saveSnapshot` is a compaction: it drops the log because the new snapshot
    // already contains it. An append that lands after it must not leave the
    // entry describing a delta the snapshot already has.
    const store = freshStore();
    await store.saveSnapshot("doc-a", new Uint8Array([0]));
    await store.appendChange("doc-a", {
      clientSeq: 1,
      bytes: new Uint8Array([1]),
    });

    await Promise.all([
      store.saveSnapshot("doc-a", new Uint8Array([9])),
      store.appendChange("doc-a", {
        clientSeq: 2,
        bytes: new Uint8Array([2]),
      }),
    ]);

    const stored = await store.load("doc-a");
    expect(Array.from(stored!.snapshot)).toEqual([9]);

    // The real hazard is clientSeq 2, not 1. Nothing ever rewrites 1, so
    // asserting its absence holds under every interleaving and tests nothing.
    // 2 is the one that can land on either side of the compaction, and the
    // entry has to stay consistent either way: if the append won the race, its
    // change is a delta the new snapshot does not contain and must be
    // replayable; if compaction won, the log is empty.
    const seqs = stored!.changes.map((c) => c.clientSeq);
    expect(seqs.length === 0 || seqs.join() === "2").toBe(true);
    // And never a delta the snapshot already folded in.
    expect(seqs).not.toContain(1);
  });

  it("survives concurrent loads during a write", async () => {
    const store = freshStore();
    await store.saveSnapshot("doc-a", new Uint8Array([1, 2, 3]));

    await store.saveMeta("doc-a", new Uint8Array([7]));

    const [, first, second] = await Promise.all([
      store.appendChange("doc-a", {
        clientSeq: 1,
        bytes: new Uint8Array([4]),
      }),
      store.load("doc-a"),
      store.load("doc-a"),
    ]);

    // The snapshot alone proves nothing: `appendChange`'s transaction does not
    // span the snapshot store, so asserting only that would pass for an
    // implementation that discarded the change entirely. The rows that can
    // actually tear are the header and the log, so read those.
    for (const stored of [first, second]) {
      expect(Array.from(stored!.snapshot)).toEqual([1, 2, 3]);
      expect(Array.from(stored!.meta!)).toEqual([7]);
      // Either the append had landed or it had not; a half-visible log — an
      // entry whose bytes are absent, or a clientSeq that was never written —
      // is what must not appear.
      const seqs = stored!.changes.map((c) => c.clientSeq);
      expect(seqs.length === 0 || seqs.join() === "1").toBe(true);
      for (const change of stored!.changes) {
        expect(Array.from(change.bytes)).toEqual([4]);
      }
    }

    // And the append did land, whatever the readers saw mid-flight.
    expect(await store.changeCount("doc-a")).toBe(1);
  });
});
