import { describe, it, expect } from "vitest";
import type { DocStore } from "@yorkie-js/sdk";

/**
 * The `DocStore` contract, as `@yorkie-js/sdk` defines it.
 *
 * Transcribed from the SDK's own `packages/sdk/test/unit/client/
 * doc_store_contract.ts` at tag `v0.7.22`. It is a copy because the SDK
 * publishes only `dist` — the suite lives under `test/`, so there is nothing to
 * import. That copy is exactly the drift the SDK wrote this suite to prevent:
 * its two stores once disagreed on whether `saveSnapshot` keeps `meta` and
 * whether `saveMeta` trims the log, each suite asserting its own behavior, so
 * both were green while an app following the documented contract was wrong.
 *
 * What keeps this copy honest is the caller, not this file:
 * `wafflebase-doc-store.test.ts` runs it against the SDK's published
 * `MemoryDocStore` as well as ours. A rule that drifts from upstream therefore
 * fails against upstream's own implementation, on the next SDK bump, in CI.
 *
 * `factory` must return a store backed by storage unique to that call, so cases
 * do not share state.
 */
export function testDocStoreContract(
  name: string,
  factory: (scope: string) => DocStore,
): void {
  describe(`DocStore contract (${name})`, () => {
    it("answers undefined for an unknown key", async () => {
      const store = factory("unknown");
      expect(await store.load("nope")).toBeUndefined();
    });

    it("round-trips a snapshot with an empty log and no meta", async () => {
      const store = factory("roundtrip");
      await store.saveSnapshot("a", new Uint8Array([1, 2, 3]));

      const stored = await store.load("a");
      expect(Array.from(stored!.snapshot)).toEqual([1, 2, 3]);
      expect(stored!.changes).toEqual([]);
      expect(stored!.meta).toBeUndefined();
    });

    it("overwrites the snapshot on repeated saveSnapshot", async () => {
      const store = factory("overwrite");
      await store.saveSnapshot("a", new Uint8Array([1]));
      await store.saveSnapshot("a", new Uint8Array([2, 3]));

      expect(Array.from((await store.load("a"))!.snapshot)).toEqual([2, 3]);
    });

    it("returns appended changes ordered by clientSeq", async () => {
      const store = factory("order");
      await store.saveSnapshot("a", new Uint8Array([0]));
      // Out of order on purpose: the store owes an ordered log, because replay
      // applies the entries in sequence.
      await store.appendChange("a", {
        clientSeq: 2,
        bytes: new Uint8Array([2]),
      });
      await store.appendChange("a", {
        clientSeq: 1,
        bytes: new Uint8Array([1]),
      });

      const stored = await store.load("a");
      expect(stored!.changes.map((c) => c.clientSeq)).toEqual([1, 2]);
      expect(Array.from(stored!.changes[0].bytes)).toEqual([1]);
    });

    it("treats appendChange as an upsert keyed by clientSeq", async () => {
      // A retried write must not become a second entry. Replaying a duplicate
      // would apply the operation twice.
      const store = factory("upsert");
      await store.saveSnapshot("a", new Uint8Array([0]));
      await store.appendChange("a", {
        clientSeq: 1,
        bytes: new Uint8Array([1]),
      });
      await store.appendChange("a", {
        clientSeq: 1,
        bytes: new Uint8Array([9]),
      });

      const stored = await store.load("a");
      expect(stored!.changes.length).toBe(1);
      expect(Array.from(stored!.changes[0].bytes)).toEqual([9]);
    });

    it("ignores an append for a key with no entry", async () => {
      // There is no snapshot for it to be a delta against, and a row written
      // anyway is an orphan `load` cannot see.
      const store = factory("orphan");
      await store.appendChange("a", {
        clientSeq: 1,
        bytes: new Uint8Array([1]),
      });
      expect(await store.load("a")).toBeUndefined();
    });

    it("drops the log and the meta when the snapshot is replaced", async () => {
      // Compaction. The new snapshot already contains those changes, and it
      // embeds a newer header than meta holds — keeping either would replay
      // operations twice or regress the client's clocks.
      const store = factory("compact");
      await store.saveSnapshot("a", new Uint8Array([0]));
      await store.appendChange("a", {
        clientSeq: 1,
        bytes: new Uint8Array([1]),
      });
      await store.saveMeta("a", new Uint8Array([7]));
      await store.saveSnapshot("a", new Uint8Array([9]));

      const stored = await store.load("a");
      expect(Array.from(stored!.snapshot)).toEqual([9]);
      expect(stored!.changes).toEqual([]);
      expect(stored!.meta).toBeUndefined();
    });

    it("records meta without touching the snapshot or the log", async () => {
      // The log is the delta between the snapshot and current content as well
      // as the queue of un-pushed changes. Trimming acked entries serves the
      // queue and destroys the delta, since a push-ack does not bring the
      // snapshot forward. Only compaction trims.
      const store = factory("meta");
      await store.saveSnapshot("a", new Uint8Array([0]));
      for (const clientSeq of [1, 2, 3]) {
        await store.appendChange("a", {
          clientSeq,
          bytes: new Uint8Array([clientSeq]),
        });
      }

      await store.saveMeta("a", new Uint8Array([7]));

      const stored = await store.load("a");
      expect(stored!.changes.map((c) => c.clientSeq)).toEqual([1, 2, 3]);
      expect(Array.from(stored!.meta!)).toEqual([7]);
      expect(Array.from(stored!.snapshot)).toEqual([0]);
    });

    it("treats saveMeta on an absent entry as a no-op", async () => {
      const store = factory("meta-absent");
      await store.saveMeta("missing", new Uint8Array([1]));
      expect(await store.load("missing")).toBeUndefined();
    });

    it("clears snapshot, meta and log on remove", async () => {
      const store = factory("remove");
      await store.saveSnapshot("a", new Uint8Array([1]));
      await store.saveMeta("a", new Uint8Array([2]));
      await store.appendChange("a", {
        clientSeq: 1,
        bytes: new Uint8Array([3]),
      });

      await store.remove("a");
      expect(await store.load("a")).toBeUndefined();
      // remove on a missing key is a no-op.
      await store.remove("missing");
    });

    it("isolates stored bytes from caller mutation on both sides", async () => {
      const store = factory("isolation");
      const snapshot = new Uint8Array([1, 2, 3]);
      const change = new Uint8Array([4, 5]);
      await store.saveSnapshot("a", snapshot);
      await store.appendChange("a", { clientSeq: 1, bytes: change });

      snapshot[0] = 99;
      change[0] = 99;
      const first = (await store.load("a"))!;
      expect(Array.from(first.snapshot)).toEqual([1, 2, 3]);
      expect(Array.from(first.changes[0].bytes)).toEqual([4, 5]);

      first.snapshot[1] = 88;
      first.changes[0].bytes[1] = 88;
      const second = (await store.load("a"))!;
      expect(Array.from(second.snapshot)).toEqual([1, 2, 3]);
      expect(Array.from(second.changes[0].bytes)).toEqual([4, 5]);
    });
  });
}
