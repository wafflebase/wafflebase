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
