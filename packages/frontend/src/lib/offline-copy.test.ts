import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { Document } from "@yorkie-js/sdk";
import { WafflebaseDocStore } from "./wafflebase-doc-store";
import {
  offlineCopyTitle,
  rehydrateArchive,
  listRecoverableWork,
} from "./offline-copy";

/**
 * Work the SDK could not reconcile comes back as a document.
 *
 * `LocalChangesDropped` fires on three unrecoverable paths — the document was
 * force-compacted while we were away, it was deleted upstream, or the stored
 * envelope belongs to another identity. The SDK does not replay those changes;
 * it reports them and calls `remove`. The store archives instead of deleting,
 * and this is what turns those bytes back into something the user can open.
 */

let counter = 0;

function freshStore(): WafflebaseDocStore {
  counter += 1;
  return new WafflebaseDocStore({
    dbName: `wafflebase-copy-${counter}`,
    userId: "user-1",
  });
}

type Root = { title?: string; body?: string };

/** Persists a document the way the SDK would, then loses it the way it does. */
async function archiveEdited(
  store: WafflebaseDocStore,
  docKey: string,
): Promise<void> {
  const doc = new Document<Root>(docKey);
  doc.setActor("000000000000000000000001");
  doc.update((root) => {
    root.title = "Quarterly plan";
  });
  await store.saveSnapshot(docKey, doc.toBytes());

  // An edit made after the snapshot — the unsent work the user would lose.
  const before = doc.getPendingChangesAfter(0).length;
  doc.update((root) => {
    root.body = "typed while offline";
  });
  for (const change of doc.getPendingChangesAfter(0).slice(before)) {
    await store.appendChange(docKey, {
      clientSeq: change.clientSeq,
      bytes: new TextEncoder().encode(JSON.stringify(change.struct)),
    });
  }

  store.expectLoss(docKey);

  await store.remove(docKey);
}

describe("naming the copy", () => {
  it("says what it is, the way a conflicted copy does", () => {
    expect(offlineCopyTitle("Quarterly plan")).toBe(
      "Quarterly plan (offline copy)",
    );
  });

  it("does not stack the suffix on a copy of a copy", () => {
    // Recovering twice from the same archive, or archiving a recovered
    // document, should not produce "x (offline copy) (offline copy)".
    expect(offlineCopyTitle("Quarterly plan (offline copy)")).toBe(
      "Quarterly plan (offline copy)",
    );
  });

  it("falls back to something openable when there is no title", () => {
    expect(offlineCopyTitle("")).toBe("Untitled (offline copy)");
  });
});

describe("rehydrating what was archived", () => {
  it("returns the content including the edits made after the snapshot", async () => {
    // The whole point. The snapshot alone is the document as it stood before
    // the unsent work, so a recovery that replayed nothing would hand back
    // precisely what the user did not lose.
    const store = freshStore();
    await archiveEdited(store, "note-7");

    const [entry] = await store.listArchives();
    const recovered = await rehydrateArchive<Root>(store, entry.id);

    expect(recovered).toBeDefined();
    expect(recovered!.docKey).toBe("note-7");
    expect(recovered!.root.title).toBe("Quarterly plan");
    expect(recovered!.root.body).toBe("typed while offline");
  });

  it("returns the snapshot's content when the log is empty", async () => {
    const store = freshStore();
    const doc = new Document<Root>("note-8");
    doc.setActor("000000000000000000000001");
    doc.update((root) => {
      root.title = "Just the base";
    });
    await store.saveSnapshot("note-8", doc.toBytes());
    store.expectLoss("note-8");
    await store.remove("note-8");

    const [entry] = await store.listArchives();
    const recovered = await rehydrateArchive<Root>(store, entry.id);
    expect(recovered!.root.title).toBe("Just the base");
  });

  it("answers undefined for an archive that is not there", async () => {
    const store = freshStore();
    expect(await rehydrateArchive(store, 999)).toBeUndefined();
  });

  it("does not throw when the archived bytes are unreadable", async () => {
    // A corrupt archive is one lost document. Throwing out of recovery would
    // take the list of every *other* recoverable document with it.
    const store = freshStore();
    await store.saveSnapshot("note-9", new Uint8Array([1, 2, 3, 4]));
    store.expectLoss("note-9");
    await store.remove("note-9");

    const [entry] = await store.listArchives();
    expect(await rehydrateArchive(store, entry.id)).toBeUndefined();
  });
});

describe("listing what can be recovered", () => {
  it("reports one entry per archived document", async () => {
    const store = freshStore();
    await archiveEdited(store, "note-7");
    await archiveEdited(store, "note-8");

    const work = await listRecoverableWork(store);
    expect(work.map((w) => w.docKey).sort()).toEqual(["note-7", "note-8"]);
  });

  it("is empty when nothing failed to reconcile", async () => {
    const store = freshStore();
    await store.saveSnapshot("note-7", new Uint8Array([1]));
    expect(await listRecoverableWork(store)).toEqual([]);
  });

  it("names the document rather than the store key", async () => {
    // The store key is `apiKey/clientKey/docKey`, which is not something to
    // put in front of a user or to route on.
    const store = freshStore();
    await archiveEdited(store, "/wb:u1:note-7/note-7");

    const [work] = await listRecoverableWork(store);
    expect(work.documentId).toBe("note-7");
  });
});

describe("a log that is not whole", () => {
  /** Stores a snapshot plus exactly the clientSeqs given, in order. */
  async function archiveWithSeqs(
    store: WafflebaseDocStore,
    docKey: string,
    seqs: Array<number>,
    corrupt: Array<number> = [],
  ): Promise<void> {
    const doc = new Document<Root>(docKey);
    doc.setActor("000000000000000000000001");
    doc.update((root) => {
      root.title = "Quarterly plan";
    });
    await store.saveSnapshot(docKey, doc.toBytes());

    // One real change per requested clientSeq, written under that number.
    for (const seq of seqs) {
      const before = doc.getPendingChangesAfter(0).length;
      doc.update((root) => {
        root.body = `edit ${seq}`;
      });
      const minted = doc.getPendingChangesAfter(0).slice(before)[0];
      await store.appendChange(docKey, {
        clientSeq: seq,
        bytes: corrupt.includes(seq)
          ? new Uint8Array([0xff, 0xfe, 0xfd])
          : new TextEncoder().encode(JSON.stringify(minted.struct)),
      });
    }

    store.expectLoss(docKey);

    await store.remove(docKey);
  }

  it("stops at a gap instead of replaying across it", async () => {
    // The SDK states the precondition outright: the log must be contiguous and
    // ascending, and a caller that cannot satisfy it should restore from the
    // snapshot alone and report the loss. Replaying 2 and 4 with 3 missing
    // produces a document the user never had — plausible, missing an edit, and
    // handed back with nothing to say so. Gaps are reachable: this is the
    // recovery path for documents the SDK already failed to reconcile.
    const store = freshStore();
    await archiveWithSeqs(store, "note-7", [2, 4]);

    const [entry] = await store.listArchives();
    const recovered = await rehydrateArchive<Root>(store, entry.id);

    expect(recovered).toBeDefined();
    expect(recovered!.complete).toBe(false);
    expect(recovered!.replayed).toBe(1);
    expect(recovered!.of).toBe(2);
    // The prefix is true as far as it goes.
    expect(recovered!.root.body).toBe("edit 2");
  });

  it("keeps the readable prefix when a later entry is corrupt", async () => {
    // One bad entry is not a reason to throw away the snapshot and the entries
    // that were fine — that turns a partial loss into a total one.
    const store = freshStore();
    await archiveWithSeqs(store, "note-8", [1, 2], [2]);

    const [entry] = await store.listArchives();
    const recovered = await rehydrateArchive<Root>(store, entry.id);

    expect(recovered).toBeDefined();
    expect(recovered!.complete).toBe(false);
    expect(recovered!.replayed).toBe(1);
    expect(recovered!.root.body).toBe("edit 1");
  });

  it("reports a whole log as complete", async () => {
    const store = freshStore();
    await archiveWithSeqs(store, "note-9", [1, 2]);

    const [entry] = await store.listArchives();
    const recovered = await rehydrateArchive<Root>(store, entry.id);

    expect(recovered!.complete).toBe(true);
    expect(recovered!.replayed).toBe(2);
  });
});
