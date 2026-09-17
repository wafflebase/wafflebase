import "fake-indexeddb/auto";
import { describe, it, expect, vi, afterEach } from "vitest";
import { WafflebaseDocStore } from "./wafflebase-doc-store";
import { eraseOfflineData, watchForOfflineDisable } from "./offline-erase";
import {
  setOfflinePersistenceEnabled,
  getOfflinePersistenceEnabled,
} from "./offline-persistence-preference";

/**
 * Settings says, of the offline toggle: "turning this off deletes them."
 *
 * That sentence is the product of this module. A toggle that leaves the
 * content behind is not the control it presents itself as — and the content it
 * leaves behind is document text on a disk the user just said they did not
 * want it on.
 */

let counter = 0;

function freshStore(userId = "user-1"): WafflebaseDocStore {
  counter += 1;
  return new WafflebaseDocStore({
    dbName: `wafflebase-erase-${counter}`,
    userId,
  });
}

async function seed(store: WafflebaseDocStore, key: string): Promise<void> {
  await store.saveSnapshot(key, new Uint8Array([1, 2, 3]));
  await store.appendChange(key, { clientSeq: 1, bytes: new Uint8Array([4]) });
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("erasing", () => {
  it("leaves nothing loadable for that user", async () => {
    const store = freshStore();
    await seed(store, "doc-a");
    await seed(store, "doc-b");

    await eraseOfflineData(store, "user-1");

    expect(await store.load("doc-a")).toBeUndefined();
    expect(await store.load("doc-b")).toBeUndefined();
  });

  it("takes the archives with it", async () => {
    // The archive holds a whole document. Erasing the live entries and leaving
    // it is the worst of both: the user is told it is gone, and the copy sits
    // where they cannot see it.
    const store = freshStore();
    await seed(store, "doc-a");
    await store.remove("doc-a");
    expect(await store.listArchives()).not.toEqual([]);

    await eraseOfflineData(store, "user-1");

    expect(await store.listArchives()).toEqual([]);
  });

  it("leaves another account's entries on the same device alone", async () => {
    // Turning *my* setting off is not a statement about anyone else's
    // documents, and a shared machine is exactly the case this feature is
    // careful about.
    const mine = freshStore("user-1");
    await seed(mine, "doc-a");
    const theirs = new WafflebaseDocStore({
      dbName: mine.databaseName,
      userId: "user-2",
    });
    await seed(theirs, "doc-c");

    await eraseOfflineData(mine, "user-1");

    expect(await theirs.load("doc-c")).toBeDefined();
  });

  it("does not throw when there is nothing to erase", async () => {
    const store = freshStore();
    await expect(eraseOfflineData(store, "user-1")).resolves.not.toThrow();
  });
});

describe("watching the preference", () => {
  it("erases when it is switched off", async () => {
    const store = freshStore();
    setOfflinePersistenceEnabled(true);
    await seed(store, "doc-a");

    const stop = watchForOfflineDisable(
      () => store,
      () => "user-1",
    );
    setOfflinePersistenceEnabled(false);
    await vi.waitFor(async () =>
      expect(await store.load("doc-a")).toBeUndefined(),
    );
    stop();
  });

  it("does not erase when it is switched on", async () => {
    // The obvious failure mode of a change listener: reacting to both edges.
    const store = freshStore();
    await seed(store, "doc-a");

    const stop = watchForOfflineDisable(
      () => store,
      () => "user-1",
    );
    setOfflinePersistenceEnabled(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await store.load("doc-a")).toBeDefined();
    stop();
  });

  it("stops watching once released", async () => {
    const store = freshStore();
    setOfflinePersistenceEnabled(true);
    await seed(store, "doc-a");

    const stop = watchForOfflineDisable(
      () => store,
      () => "user-1",
    );
    stop();

    setOfflinePersistenceEnabled(false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await store.load("doc-a")).toBeDefined();
  });

  it("erases for whoever is signed in at the time, not at setup", async () => {
    // The watcher outlives a sign-out and sign-in, and erasing the wrong
    // account's documents would be the same harm this module exists to avoid.
    const store = freshStore("user-2");
    setOfflinePersistenceEnabled(true);
    await seed(store, "doc-a");

    let who = "user-1";
    const stop = watchForOfflineDisable(
      () => store,
      () => who,
    );
    who = "user-2";
    setOfflinePersistenceEnabled(false);

    await vi.waitFor(async () =>
      expect(await store.load("doc-a")).toBeUndefined(),
    );
    stop();
  });

  it("survives an erase that fails, leaving the preference off", async () => {
    // The user asked for it to stop saving. If the cleanup throws, the answer
    // is still "it is off" — re-enabling it to match the disk would be the
    // setting fighting the user.
    const store = freshStore();
    setOfflinePersistenceEnabled(true);
    vi.spyOn(store, "dropAllForUser").mockRejectedValue(new Error("nope"));

    const stop = watchForOfflineDisable(
      () => store,
      () => "user-1",
    );
    expect(() => setOfflinePersistenceEnabled(false)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(getOfflinePersistenceEnabled()).toBe(false);
    stop();
  });
});

describe("when no editor is open", () => {
  it("still erases, because that is when the toggle is switched off", async () => {
    // Settings is its own route, so the one moment the user turns this off is
    // the one moment no editor is mounted. Declining there skips the erase
    // exactly when it is asked for — and spends the edge doing it, since the
    // preference is now off and no later change fires again.
    const seeded = new WafflebaseDocStore({ userId: "user-1" });
    setOfflinePersistenceEnabled(true);
    await seed(seeded, "doc-a");

    // The app has no store to hand over.
    const stop = watchForOfflineDisable(
      () => undefined,
      () => "user-1",
    );
    setOfflinePersistenceEnabled(false);

    // The fallback opens the default database, so point the check there.
    const app = new WafflebaseDocStore({ userId: "user-1" });
    await vi.waitFor(async () =>
      expect(await app.load("doc-a")).toBeUndefined(),
    );
    stop();
  });

  it("does nothing when nobody is signed in", async () => {
    // No identity means no scope to erase under, and erasing everything on the
    // device would reach another account's documents.
    const store = freshStore();
    setOfflinePersistenceEnabled(true);
    await seed(store, "doc-a");

    const stop = watchForOfflineDisable(
      () => store,
      () => undefined,
    );
    setOfflinePersistenceEnabled(false);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(await store.load("doc-a")).toBeDefined();
    stop();
  });
});
