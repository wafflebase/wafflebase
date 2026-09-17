import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { WafflebaseDocStore } from "./wafflebase-doc-store";

/**
 * `remove` is called on exactly the paths where the SDK has decided local work
 * cannot be reconciled — a re-anchor after server-side compaction, a document
 * purged upstream, an actor mismatch. Deleting there is what loses the work
 * W5 exists to give back, so the archive is written now even though nothing
 * reads it until then.
 */

let counter = 0;

function clock(iso: string) {
  let t = Date.parse(iso);
  return {
    now: () => t,
    set: (next: string) => {
      t = Date.parse(next);
    },
  };
}

function freshStore(now?: () => number): WafflebaseDocStore {
  counter += 1;
  return new WafflebaseDocStore({
    dbName: `wafflebase-archive-${counter}`,
    userId: "user-1",
    now,
  });
}

describe("archiving on remove", () => {
  it("keeps the content after remove has made it unloadable", async () => {
    const store = freshStore();
    await store.saveSnapshot("doc-a", new Uint8Array([1, 2, 3]));
    await store.appendChange("doc-a", {
      clientSeq: 1,
      bytes: new Uint8Array([4, 5]),
    });

    await store.remove("doc-a");

    expect(await store.load("doc-a")).toBeUndefined();

    const archives = await store.listArchives();
    expect(archives.length).toBe(1);
    expect(archives[0].docKey).toBe("doc-a");

    // The bytes come back as they went in — this is the copy W5 hands the user
    // as a document, so a lossy archive is the same as no archive.
    const archived = await store.loadArchive(archives[0].id);
    expect(Array.from(archived!.snapshot)).toEqual([1, 2, 3]);
    expect(archived!.changes.map((c) => c.clientSeq)).toEqual([1]);
    expect(Array.from(archived!.changes[0].bytes)).toEqual([4, 5]);
  });

  it("archives the meta header too", async () => {
    // Without it the copy cannot say where the document stood against the
    // server, and W5 would be reconstructing from a snapshot whose own header
    // predates the last sync.
    const store = freshStore();
    await store.saveSnapshot("doc-a", new Uint8Array([1]));
    await store.saveMeta("doc-a", new Uint8Array([7]));

    await store.remove("doc-a");

    const [entry] = await store.listArchives();
    const archived = await store.loadArchive(entry.id);
    expect(Array.from(archived!.meta!)).toEqual([7]);
  });

  it("archives nothing when there was nothing stored", async () => {
    // `remove` on a missing key is a no-op, and an empty archive would be a
    // row W5 offers the user as recoverable work that does not exist.
    const store = freshStore();
    await store.remove("never-existed");
    expect(await store.listArchives()).toEqual([]);
  });

  it("keeps each removal rather than overwriting the last", async () => {
    // Two documents can fail to reconcile in one session, and the second must
    // not silently replace the first.
    const store = freshStore();
    await store.saveSnapshot("doc-a", new Uint8Array([1]));
    await store.saveSnapshot("doc-b", new Uint8Array([2]));

    await store.remove("doc-a");
    await store.remove("doc-b");

    const archives = await store.listArchives();
    expect(archives.map((a) => a.docKey).sort()).toEqual(["doc-a", "doc-b"]);
  });

  it("does not archive on purge", async () => {
    // Losing access to a document says nothing about the user being owed a
    // copy of it, and keeping one would outlive the authority to read it.
    const store = freshStore();
    await store.saveSnapshot("doc-a", new Uint8Array([1]));

    await store.purge("doc-a");

    expect(await store.listArchives()).toEqual([]);
  });

  it("collects archives on the same schedule as live entries", async () => {
    // An archive store nothing ever collects is a quota leak that looks like a
    // feature.
    const time = clock("2026-01-01T00:00:00Z");
    const store = freshStore(time.now);
    await store.saveSnapshot("doc-a", new Uint8Array([1]));
    await store.remove("doc-a");

    time.set("2026-03-01T00:00:00Z");
    await store.collectStale(30 * 24 * 60 * 60 * 1000);

    expect(await store.listArchives()).toEqual([]);
  });

  it("drops a user's archives on logout", async () => {
    // The archive holds document content, so the erase logout promises has to
    // reach it — otherwise signing out leaves the content on a shared machine
    // in the one place the user cannot see.
    const store = freshStore();
    await store.saveSnapshot("doc-a", new Uint8Array([1]));
    await store.remove("doc-a");

    await store.dropAllForUser("user-1");

    expect(await store.listArchives()).toEqual([]);
  });
});

describe("archives belong to whoever wrote them", () => {
  it("lists only this user's, on a device two accounts share", async () => {
    // The archive holds a whole document. Listing another account's would hand
    // their content to whoever is signed in — the recovery path turns an
    // archive into a document *for the current user*, so an unscoped list is a
    // cross-account content leak, not merely untidy.
    const mine = freshStore();
    await mine.saveSnapshot("doc-a", new Uint8Array([1]));
    await mine.remove("doc-a");

    const theirs = new WafflebaseDocStore({
      dbName: mine.databaseName,
      userId: "user-2",
    });
    await theirs.saveSnapshot("doc-b", new Uint8Array([2]));
    await theirs.remove("doc-b");

    expect((await mine.listArchives()).map((a) => a.docKey)).toEqual(["doc-a"]);
    expect((await theirs.listArchives()).map((a) => a.docKey)).toEqual([
      "doc-b",
    ]);
  });

  it("refuses to load an archive belonging to someone else", async () => {
    // Belt and braces: an id can be held from before a sign-out, and the
    // listing is not the only way into `loadArchive`.
    const mine = freshStore();
    const theirs = new WafflebaseDocStore({
      dbName: mine.databaseName,
      userId: "user-2",
    });
    await theirs.saveSnapshot("doc-b", new Uint8Array([2]));
    await theirs.remove("doc-b");

    const [entry] = await theirs.listArchives();
    expect(await mine.loadArchive(entry.id)).toBeUndefined();
  });
});
