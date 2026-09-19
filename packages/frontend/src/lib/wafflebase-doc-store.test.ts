import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryDocStore } from "@yorkie-js/sdk";
import { testDocStoreContract } from "./doc-store-contract";
import { WafflebaseDocStore } from "./wafflebase-doc-store";

/**
 * Both implementations answer the same contract.
 *
 * `MemoryDocStore` is here for the copy, not for itself: the contract file is
 * transcribed from the SDK because the suite is not published, so running it
 * against the SDK's own store is what turns a drifted rule into a CI failure
 * rather than a quiet disagreement. See `doc-store-contract.ts`.
 */
testDocStoreContract("MemoryDocStore", () => new MemoryDocStore());
testDocStoreContract(
  "WafflebaseDocStore",
  (scope) =>
    new WafflebaseDocStore({
      dbName: `wafflebase-test-${scope}`,
      userId: "user-1",
    }),
);

describe("WafflebaseDocStore compression", () => {
  let store: WafflebaseDocStore;
  // A monotonic counter, not `Date.now()`: these cases run inside one
  // millisecond, so a timestamped name would hand them all the same database.
  let counter = 0;

  beforeEach(() => {
    counter += 1;
    store = new WafflebaseDocStore({
      dbName: `wafflebase-gzip-${counter}`,
      userId: "user-1",
    });
  });

  it("stores fewer bytes than it was given for repetitive input", async () => {
    // The reason the store compresses at all: CRDT snapshots repeat a 24-hex
    // actor id per member, and gzip returns 11-18x on them. Asserting the ratio
    // would be asserting zlib's behavior; asserting that what lands on disk is
    // not the input verbatim is asserting ours.
    const repetitive = new TextEncoder().encode(
      '{"actor":"000000000000000000000001"}'.repeat(200),
    );
    await store.saveSnapshot("a", repetitive);

    const storedSize = await store.storedSnapshotSize("a");
    expect(storedSize).toBeDefined();
    expect(storedSize!).toBeLessThan(repetitive.length / 4);

    // And it still round-trips.
    const stored = await store.load("a");
    expect(Array.from(stored!.snapshot)).toEqual(Array.from(repetitive));
  });

  it("round-trips bytes that gzip cannot shrink", async () => {
    // Incompressible input is the case where a "compress only if smaller"
    // optimization would silently change the stored format. Whatever the store
    // decides, `load` owes the original bytes back.
    const noise = new Uint8Array(512);
    for (let i = 0; i < noise.length; i++) {
      // Deterministic, but with no runs for gzip to exploit.
      noise[i] = (i * 167 + 13) % 256;
    }
    await store.saveSnapshot("a", noise);

    const stored = await store.load("a");
    expect(Array.from(stored!.snapshot)).toEqual(Array.from(noise));
  });

  it("round-trips an empty snapshot", async () => {
    await store.saveSnapshot("a", new Uint8Array([]));
    const stored = await store.load("a");
    expect(stored).toBeDefined();
    expect(stored!.snapshot.length).toBe(0);
  });
});
