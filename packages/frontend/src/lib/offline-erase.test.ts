import "fake-indexeddb/auto";
import { describe, it, expect, vi, afterEach } from "vitest";
import { WafflebaseDocStore } from "./wafflebase-doc-store";
import {
  eraseOfflineData,
  eraseOfflineDataOnLogout,
  purgeOfflineDocuments,
  purgeRevokedOfflineDocuments,
  rememberOfflineUser,
  retryPendingOfflineErase,
  watchForOfflineDisable,
} from "./offline-erase";
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
    // An ordinary detach archives nothing, so the loss has to be declared —
    // this case is about the archive that a *loss* leaves behind.
    store.expectLoss("doc-a");
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

describe("signing out", () => {
  /**
   * These use the default database, because that is what the logout path
   * opens: it has no store instance to borrow, only the identity the shell
   * recorded while there was one. Keys are unique per case so the shared
   * database cannot leak between them.
   */
  function defaultStore(userId: string): WafflebaseDocStore {
    return new WafflebaseDocStore({ userId });
  }

  it("erases the signed-out user's documents and nobody else's", async () => {
    // A device two accounts share is the case this feature is careful about,
    // and signing out is where content must stop outliving the session.
    const mine = defaultStore("logout-1");
    const theirs = defaultStore("logout-2");
    await seed(mine, "logout-mine");
    await seed(theirs, "logout-theirs");

    rememberOfflineUser("logout-1");
    await eraseOfflineDataOnLogout();

    expect(await mine.load("logout-mine")).toBeUndefined();
    expect(await theirs.load("logout-theirs")).toBeDefined();
  });

  it("erases regardless of what the preference now says", async () => {
    // The preference decides whether new content is written. It says nothing
    // about content written while it was on, and leaving a signed-out
    // account's documents behind because the toggle has since been flipped
    // would be the worst reading of it.
    const mine = defaultStore("logout-3");
    await seed(mine, "logout-pref");
    setOfflinePersistenceEnabled(false);

    rememberOfflineUser("logout-3");
    await eraseOfflineDataOnLogout();

    expect(await mine.load("logout-pref")).toBeUndefined();
  });

  it("does nothing, and throws nothing, when nobody was recorded", async () => {
    rememberOfflineUser(undefined);
    await expect(eraseOfflineDataOnLogout()).resolves.toBeUndefined();
  });

  it("keeps the archives when the session was ended for the user", async () => {
    // A cookie that expired is nobody's decision, and the archives are the only
    // copy of work the server never took. The live entries still go: the server
    // holds that content, and a shared machine should not.
    const mine = defaultStore("logout-4");
    await seed(mine, "logout-expired");
    mine.expectLoss("logout-expired");
    await mine.remove("logout-expired");
    await seed(mine, "logout-live");

    rememberOfflineUser("logout-4");
    await eraseOfflineDataOnLogout({ keepArchives: true });

    expect(await mine.load("logout-live")).toBeUndefined();
    expect(await mine.listArchives()).toHaveLength(1);
  });

  it("does not forget who it is for when the erase fails", async () => {
    // Clearing the identity first made a transient IndexedDB failure
    // permanent: nothing could name the account whose documents were still on
    // the disk, and the user was told "Logged out successfully".
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = vi
      .spyOn(WafflebaseDocStore.prototype, "dropAllForUser")
      .mockRejectedValue(new Error("nope"));

    rememberOfflineUser("logout-5");
    await expect(eraseOfflineDataOnLogout()).resolves.toBeUndefined();
    failing.mockRestore();

    const mine = defaultStore("logout-5");
    await seed(mine, "logout-retry");

    // The retry is what the next session runs, whoever signs in on it.
    await retryPendingOfflineErase();
    expect(await mine.load("logout-retry")).toBeUndefined();
  });

  it("keeps one account's owed erase when another signs out successfully", async () => {
    // The marker used to be a single slot, cleared unconditionally by whoever
    // signed out next — and that is by definition not the account still owed
    // an erase. A's documents then stayed on a shared device with nothing left
    // naming them.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = defaultStore("logout-a");
    await seed(a, "a-doc");

    const failing = vi
      .spyOn(WafflebaseDocStore.prototype, "dropAllForUser")
      .mockRejectedValue(new Error("nope"));
    rememberOfflineUser("logout-a");
    await eraseOfflineDataOnLogout();
    failing.mockRestore();

    // B signs in and out cleanly on the same device.
    const b = defaultStore("logout-b");
    await seed(b, "b-doc");
    rememberOfflineUser("logout-b");
    await eraseOfflineDataOnLogout();

    // A is still owed, and the next session finishes it.
    await retryPendingOfflineErase();
    expect(await a.load("a-doc")).toBeUndefined();
    expect(await b.load("b-doc")).toBeUndefined();
  });

  it("finishes every owed erase, not only the most recent", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = defaultStore("owed-a");
    const b = defaultStore("owed-b");
    await seed(a, "owed-a-doc");
    await seed(b, "owed-b-doc");

    const failing = vi
      .spyOn(WafflebaseDocStore.prototype, "dropAllForUser")
      .mockRejectedValue(new Error("nope"));
    rememberOfflineUser("owed-a");
    await eraseOfflineDataOnLogout();
    rememberOfflineUser("owed-b");
    await eraseOfflineDataOnLogout();
    failing.mockRestore();

    await retryPendingOfflineErase();

    expect(await a.load("owed-a-doc")).toBeUndefined();
    expect(await b.load("owed-b-doc")).toBeUndefined();
  });

  it("owes no retry once the erase has actually happened", async () => {
    const mine = defaultStore("logout-6");
    await seed(mine, "logout-done");
    rememberOfflineUser("logout-6");
    await eraseOfflineDataOnLogout();

    // Nothing is owed, so a later seed for the same account survives.
    await seed(mine, "logout-after");
    await retryPendingOfflineErase();
    expect(await mine.load("logout-after")).toBeDefined();
  });
});

describe("access somebody else ended", () => {
  it("drops what the server no longer lists, archives included", async () => {
    // Recovery turns an archive into a whole new document, so one that
    // survives a revoked membership is a permanent copy of content the user
    // may no longer read.
    const store = new WafflebaseDocStore({ userId: "revoked-1" });
    await seed(store, "pk/wb:1:sheet-gone/sheet-gone");
    await seed(store, "pk/wb:1:sheet-kept/sheet-kept");
    store.expectLoss("pk/wb:1:sheet-gone/sheet-gone");
    await store.remove("pk/wb:1:sheet-gone/sheet-gone");
    await seed(store, "pk/wb:1:sheet-gone/sheet-gone");
    rememberOfflineUser("revoked-1");

    expect(await purgeRevokedOfflineDocuments(["kept"])).toBe(1);

    expect(await store.load("pk/wb:1:sheet-gone/sheet-gone")).toBeUndefined();
    expect(await store.load("pk/wb:1:sheet-kept/sheet-kept")).toBeDefined();
    expect(await store.listArchives()).toEqual([]);
  });

  it("refuses an empty list rather than erasing the device", async () => {
    // The purge keeps only what is in the list, so a half-answered listing is
    // the one input that must not reach it.
    const store = new WafflebaseDocStore({ userId: "revoked-2" });
    await seed(store, "sheet-safe");
    rememberOfflineUser("revoked-2");

    expect(await purgeRevokedOfflineDocuments([])).toBe(0);
    expect(await store.load("sheet-safe")).toBeDefined();
  });

  it("does nothing while signed out", async () => {
    const store = new WafflebaseDocStore({ userId: "revoked-3" });
    await seed(store, "sheet-anon-2");
    rememberOfflineUser(undefined);

    expect(await purgeRevokedOfflineDocuments(["something"])).toBe(0);
    expect(await store.load("sheet-anon-2")).toBeDefined();
  });

  it("keeps a document another tab has open", async () => {
    // The database is shared with this user's other tabs, and the listing is a
    // snapshot of one moment. Deleting an entry a live client is writing
    // through makes every later append for it vanish while that tab's chip
    // still reports it saved — the exact failure eviction avoids.
    const store = new WafflebaseDocStore({ userId: "revoked-4" });
    await seed(store, "pk/wb:1:sheet-open/sheet-open");
    rememberOfflineUser("revoked-4");

    expect(
      await purgeRevokedOfflineDocuments(["kept"], {
        isOpenElsewhere: (docKey) => docKey.endsWith("sheet-open"),
      }),
    ).toBe(0);
    expect(await store.load("pk/wb:1:sheet-open/sheet-open")).toBeDefined();
  });

  it("keeps a document written after the listing was requested", async () => {
    // Another tab created it while `GET /documents` was in flight, so its
    // absence from the answer says nothing at all.
    const store = new WafflebaseDocStore({ userId: "revoked-5" });
    const listedAt = Date.now();
    await seed(store, "sheet-fresh");
    rememberOfflineUser("revoked-5");

    expect(
      await purgeRevokedOfflineDocuments(["kept"], { listedAt: listedAt - 1 }),
    ).toBe(0);
    expect(await store.load("sheet-fresh")).toBeDefined();

    // And it still drops a copy that predates the listing.
    expect(
      await purgeRevokedOfflineDocuments(["kept"], {
        listedAt: Date.now() + 1000,
      }),
    ).toBe(1);
  });
});

describe("a document that was deleted", () => {
  it("drops this device's copy, matching the SDK's scoped key", async () => {
    // Entries are keyed `apiKey/clientKey/docKey` with a type-prefixed
    // document key, while the caller knows only a document id.
    const store = new WafflebaseDocStore({ userId: "purge-1" });
    await seed(store, "pk/wb:1:sheet-abc/sheet-abc");
    rememberOfflineUser("purge-1");

    await purgeOfflineDocuments(["abc"]);

    expect(await store.load("pk/wb:1:sheet-abc/sheet-abc")).toBeUndefined();
  });

  it("keeps the archives, which are the user's own unsent work", async () => {
    // "Deleted upstream" is one of the three paths that produce an archive at
    // all, so dropping it here would erase the user's edits in the name of
    // cleaning up somebody else's deletion.
    const store = new WafflebaseDocStore({ userId: "purge-2" });
    await seed(store, "sheet-keep");
    store.expectLoss("sheet-keep");
    await store.remove("sheet-keep");
    rememberOfflineUser("purge-2");

    await purgeOfflineDocuments(["keep"]);

    expect(await store.listArchives()).toHaveLength(1);
  });

  it("does nothing while signed out", async () => {
    const store = new WafflebaseDocStore({ userId: "purge-3" });
    await seed(store, "sheet-anon");
    rememberOfflineUser(undefined);

    await purgeOfflineDocuments(["anon"]);

    expect(await store.load("sheet-anon")).toBeDefined();
  });
});
