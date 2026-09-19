import "fake-indexeddb/auto";
import { describe, it, expect, vi, afterEach } from "vitest";
import { WafflebaseDocStore } from "./wafflebase-doc-store";
import { durableClientKey } from "./durable-session";
import {
  eraseOfflineData,
  eraseOfflineDataOnLogout,
  isOfflineUser,
  isOfflineWritePermitted,
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

  it("takes the client-key salts with it", async () => {
    // The salt is the one ingredient of `wb:{salt}:{userId}:{docKey}` that a
    // later signed-in user of a shared device cannot otherwise obtain —
    // `userId` and `docKey` are both public to a workspace peer — and Yorkie
    // authorizes `ActivateClient`/`DeactivateClient` on token validity alone.
    // Leaving it behind for documents that are no longer even here is the
    // erase missing the very thing it is here to spend.
    const store = freshStore();
    await seed(store, "doc-a");
    const before = durableClientKey("user-1", "sheet-a");
    expect(
      localStorage.getItem("wafflebase-durable-device:user-1:sheet-a"),
    ).not.toBeNull();

    await eraseOfflineData(store, "user-1");

    expect(
      localStorage.getItem("wafflebase-durable-device:user-1:sheet-a"),
    ).toBeNull();
    expect(durableClientKey("user-1", "sheet-a")).not.toBe(before);
  });

  it("leaves another account's salt on the same device alone", async () => {
    // Same rule as the entries: erasing *my* data says nothing about theirs,
    // and dropping their salt would strand a durable session they are holding
    // right now under a key the SDK's store no longer answers to.
    const store = freshStore();
    durableClientKey("user-1", "sheet-a");
    const theirs = durableClientKey("user-2", "sheet-b");

    await eraseOfflineData(store, "user-1");

    expect(durableClientKey("user-2", "sheet-b")).toBe(theirs);
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

  it("drops the signed-out account's client-key salts, and nobody else's", async () => {
    // The sign-out is the moment this account's documents leave the device,
    // and the salt that named their client keys has to leave with them:
    // whoever signs in next can read `localStorage`, and the salt is the one
    // ingredient of `wb:{salt}:{userId}:{docKey}` they cannot otherwise
    // obtain. Asserted here and not only in `durable-session.test.ts`, which
    // tests `forgetDeviceSecret` directly — deleting the call site would
    // otherwise leave every suite green.
    const mine = defaultStore("logout-salt");
    await seed(mine, "logout-salt-doc");
    durableClientKey("logout-salt", "sheet-one");
    durableClientKey("logout-salt", "sheet-two");
    const theirs = durableClientKey("logout-other", "sheet-three");

    rememberOfflineUser("logout-salt");
    await eraseOfflineDataOnLogout();

    expect(
      localStorage.getItem("wafflebase-durable-device:logout-salt:sheet-one"),
    ).toBeNull();
    expect(
      localStorage.getItem("wafflebase-durable-device:logout-salt:sheet-two"),
    ).toBeNull();
    expect(durableClientKey("logout-other", "sheet-three")).toBe(theirs);
  });

  it("refuses further local writes for the account it just erased", async () => {
    // `dropAllForUser` marks the keys it deleted, so a still-mounted durable
    // client's next append throws — and the SDK repairs a failed append by
    // writing a fresh snapshot, which puts the document straight back on the
    // disk the sign-out cleared. The preference cannot stop that; it is still
    // on.
    const mine = defaultStore("logout-6");
    await seed(mine, "logout-rewrite");

    rememberOfflineUser("logout-6");
    expect(isOfflineWritePermitted("logout-6")).toBe(true);
    await eraseOfflineDataOnLogout();

    expect(isOfflineWritePermitted("logout-6")).toBe(false);
    // Nobody else is restrained by it.
    expect(isOfflineWritePermitted("someone-else")).toBe(true);

    // And signing back in is the user asking for their documents again.
    rememberOfflineUser("logout-6");
    expect(isOfflineWritePermitted("logout-6")).toBe(true);
  });

  it("refuses writes in the tab that did not sign out either", async () => {
    // The erase used to be enforced in one JS realm: the `erased` set lived in
    // module memory, so a second tab holding the same document never saw it,
    // kept appending, and the SDK's repair-by-snapshot put the whole document
    // back on the disk the sign-out had just cleared — with nothing scheduled
    // to remove it again. On a shared device that is this feature's primary
    // privacy control failing silently, which is why the denial has to reach
    // as far as the writers do.
    //
    // A freshly imported module is that second tab: same origin, same
    // `localStorage`, its own empty in-memory set.
    rememberOfflineUser("logout-other-tab");
    await eraseOfflineDataOnLogout();

    vi.resetModules();
    const otherTab = await import("./offline-erase");
    expect(otherTab.isOfflineWritePermitted("logout-other-tab")).toBe(false);
    // Still nobody else's problem.
    expect(otherTab.isOfflineWritePermitted("someone-else")).toBe(true);

    // And signing back in lifts it for every tab that has not already latched
    // it in memory — a tab that has stays refused until it reloads, which is
    // the safe direction: it is still holding the session that was signed out.
    otherTab.rememberOfflineUser("logout-other-tab");
    vi.resetModules();
    const thirdTab = await import("./offline-erase");
    expect(thirdTab.isOfflineWritePermitted("logout-other-tab")).toBe(true);
  });

  it("refuses writes before it deletes anything, not after", async () => {
    // The whole erase is a window in which a still-mounted durable client keeps
    // writing: the SDK repairs an append that failed against a deleted base by
    // writing a fresh snapshot, which puts the open document straight back onto
    // the disk the sign-out is in the middle of clearing. Denying afterwards
    // leaves that window open for the entire duration of the erase.
    const permitted: Array<boolean> = [];
    const mine = defaultStore("logout-order");
    await seed(mine, "logout-order-doc");

    rememberOfflineUser("logout-order");
    const spy = vi
      .spyOn(WafflebaseDocStore.prototype, "dropAllForUser")
      .mockImplementation(async function (
        this: WafflebaseDocStore,
        userId: string,
      ) {
        // Asked from inside the erase, which is where the race lives.
        permitted.push(isOfflineWritePermitted(userId));
        return 0;
      });

    await eraseOfflineDataOnLogout();
    spy.mockRestore();

    expect(permitted).toEqual([false]);
  });

  it("keeps the refusal standing when the erase fails", async () => {
    // The account is signed out either way, so there is no case for writing
    // more of their content onto this device while the retry is owed.
    const spy = vi
      .spyOn(WafflebaseDocStore.prototype, "dropAllForUser")
      .mockRejectedValue(new Error("nope"));

    rememberOfflineUser("logout-order-2");
    await eraseOfflineDataOnLogout();
    spy.mockRestore();

    expect(isOfflineWritePermitted("logout-order-2")).toBe(false);
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
    // may no longer read. `isRevoked` is what says that is the case here
    // rather than the other one — see the deletion case below.
    const store = new WafflebaseDocStore({ userId: "revoked-1" });
    await seed(store, "pk/wb:1:sheet-gone/sheet-gone");
    await seed(store, "pk/wb:1:sheet-kept/sheet-kept");
    store.expectLoss("pk/wb:1:sheet-gone/sheet-gone");
    await store.remove("pk/wb:1:sheet-gone/sheet-gone");
    await seed(store, "pk/wb:1:sheet-gone/sheet-gone");
    rememberOfflineUser("revoked-1");

    expect(
      await purgeRevokedOfflineDocuments(["kept"], { isRevoked: () => true }),
    ).toBe(1);

    expect(await store.load("pk/wb:1:sheet-gone/sheet-gone")).toBeUndefined();
    expect(await store.load("pk/wb:1:sheet-kept/sheet-kept")).toBeDefined();
    expect(await store.listArchives()).toEqual([]);
  });

  it("keeps the archive of a document that was merely deleted", async () => {
    // The reconcile ran one step before the recovery offer and destroyed
    // exactly what the offer exists to hand back. "The document was deleted or
    // GC'd upstream" is one of the three causes of an archive, so a deleted
    // document is missing from `GET /documents` *because the archive's own
    // cause happened* — absence is therefore evidence of nothing, and only a
    // positive "it is still there and you may not read it" may drop one.
    const store = new WafflebaseDocStore({ userId: "revoked-9" });
    await seed(store, "pk/wb:1:sheet-deleted/sheet-deleted");
    store.expectLoss("pk/wb:1:sheet-deleted/sheet-deleted");
    await store.remove("pk/wb:1:sheet-deleted/sheet-deleted");
    rememberOfflineUser("revoked-9");

    // A 404: gone upstream, not revoked.
    await purgeRevokedOfflineDocuments(["kept"], { isRevoked: () => false });

    expect(await store.listArchives()).toHaveLength(1);
  });

  it("keeps the archive when nothing can say which case it is", async () => {
    // With no way to tell the two apart, the direction that deletes is the
    // unrecoverable one. A kept archive is still bounded by the thirty-day
    // collection and refused by recovery's own check.
    const store = new WafflebaseDocStore({ userId: "revoked-10" });
    await seed(store, "pk/wb:1:sheet-unknown/sheet-unknown");
    store.expectLoss("pk/wb:1:sheet-unknown/sheet-unknown");
    await store.remove("pk/wb:1:sheet-unknown/sheet-unknown");
    rememberOfflineUser("revoked-10");

    await purgeRevokedOfflineDocuments(["kept"]);

    expect(await store.listArchives()).toHaveLength(1);
  });

  it("asks only about documents that actually hold an archive", async () => {
    // The question costs a request each. The ordinary reconcile has no archive
    // at all, so it must cost none.
    const store = new WafflebaseDocStore({ userId: "revoked-11" });
    await seed(store, "pk/wb:1:sheet-plain/sheet-plain");
    rememberOfflineUser("revoked-11");

    const isRevoked = vi.fn(() => true);
    await purgeRevokedOfflineDocuments(["kept"], { isRevoked });

    expect(isRevoked).not.toHaveBeenCalled();
    expect(await store.load("pk/wb:1:sheet-plain/sheet-plain")).toBeUndefined();
  });

  it("treats an empty list as the answer it is, not as a missing one", async () => {
    // A user removed from their only workspace is told exactly this, and it is
    // the case the whole function exists for. Refusing it declined the
    // reconcile precisely when it was owed.
    const store = new WafflebaseDocStore({ userId: "revoked-2" });
    await seed(store, "sheet-safe");
    rememberOfflineUser("revoked-2");

    expect(await purgeRevokedOfflineDocuments([])).toBe(1);
    expect(await store.load("sheet-safe")).toBeUndefined();
  });

  it("reaches a document that exists only as an archive", async () => {
    // `remove()` deletes the header and writes the content into the archive
    // store, so enumerating headers alone can never name it — a full snapshot
    // of a workspace's document, kept past the revocation and then offered
    // back as a new document the removed user owns.
    const store = new WafflebaseDocStore({ userId: "revoked-6" });
    await seed(store, "pk/wb:1:sheet-onlyarchive/sheet-onlyarchive");
    store.expectLoss("pk/wb:1:sheet-onlyarchive/sheet-onlyarchive");
    await store.remove("pk/wb:1:sheet-onlyarchive/sheet-onlyarchive");
    expect(await store.listArchives()).toHaveLength(1);
    rememberOfflineUser("revoked-6");

    await purgeRevokedOfflineDocuments(["kept"], { isRevoked: () => true });

    expect(await store.listArchives()).toEqual([]);
  });

  it("throws when it could not enumerate what is stored", async () => {
    // The caller gates offline-copy *recovery* on this having run: an archive
    // becomes a new document owned by whoever is signed in, so it may only be
    // offered once this session has established what the user may still read.
    // Answering `0` for a reconcile that never happened reported success and
    // opened that gate — precisely the case the gate exists for.
    const store = new WafflebaseDocStore({ userId: "revoked-7" });
    await seed(store, "pk/wb:1:sheet-listfail/sheet-listfail");
    rememberOfflineUser("revoked-7");

    const failed = new Error("the database would not open");
    const listing = vi
      .spyOn(WafflebaseDocStore.prototype, "storedDocumentIds")
      .mockRejectedValue(failed);

    await expect(purgeRevokedOfflineDocuments(["kept"])).rejects.toThrow(
      failed,
    );

    listing.mockRestore();
    // And the content is still there, which is the other half of why the
    // answer must not be a number: it was never deleted.
    expect(
      await store.load("pk/wb:1:sheet-listfail/sheet-listfail"),
    ).toBeDefined();
  });

  it("throws when a delete fails part way through", async () => {
    // Same contract on the other side of the loop. A purge that stopped early
    // has left content on the disk for a membership the server has already
    // ended, and reporting the count it managed would let recovery run on a
    // half-answered question.
    const store = new WafflebaseDocStore({ userId: "revoked-8" });
    await seed(store, "pk/wb:1:sheet-purgefail/sheet-purgefail");
    rememberOfflineUser("revoked-8");

    const failed = new Error("delete refused");
    const purge = vi
      .spyOn(WafflebaseDocStore.prototype, "purgeDocument")
      .mockRejectedValue(failed);

    await expect(purgeRevokedOfflineDocuments(["kept"])).rejects.toThrow(
      failed,
    );

    purge.mockRestore();
    expect(
      await store.load("pk/wb:1:sheet-purgefail/sheet-purgefail"),
    ).toBeDefined();
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

  it("takes the archives when the caller lost access rather than deleted it", async () => {
    // `dropArchives: true` is what `deleteWorkspace` and `removeMember` pass:
    // the documents are still there and this device may no longer hold them,
    // so an archive — a full snapshot that recovery turns into a permanent
    // document — must go with the live entries. Every existing assertion about
    // this option was made against a wholesale module mock, which proves the
    // argument was passed and nothing about what it does.
    const store = new WafflebaseDocStore({ userId: "purge-4" });
    await seed(store, "pk/wb:1:sheet-revoked/sheet-revoked");
    store.expectLoss("pk/wb:1:sheet-revoked/sheet-revoked");
    await store.remove("pk/wb:1:sheet-revoked/sheet-revoked");
    await seed(store, "pk/wb:1:sheet-revoked/sheet-revoked");
    rememberOfflineUser("purge-4");

    await purgeOfflineDocuments(["revoked"], { dropArchives: true });

    expect(await store.listArchives()).toEqual([]);
    expect(
      await store.load("pk/wb:1:sheet-revoked/sheet-revoked"),
    ).toBeUndefined();
  });

  it("leaves another document's archive alone when it drops one", async () => {
    // Scoped to the ids it was given, like every other purge here.
    const store = new WafflebaseDocStore({ userId: "purge-5" });
    await seed(store, "pk/wb:1:sheet-doomed/sheet-doomed");
    store.expectLoss("pk/wb:1:sheet-doomed/sheet-doomed");
    await store.remove("pk/wb:1:sheet-doomed/sheet-doomed");
    await seed(store, "pk/wb:1:sheet-other/sheet-other");
    store.expectLoss("pk/wb:1:sheet-other/sheet-other");
    await store.remove("pk/wb:1:sheet-other/sheet-other");
    rememberOfflineUser("purge-5");

    await purgeOfflineDocuments(["doomed"], { dropArchives: true });

    const left = await store.listArchives();
    expect(left).toHaveLength(1);
    expect(left[0].docKey).toContain("sheet-other");
  });

  it("does nothing while signed out", async () => {
    const store = new WafflebaseDocStore({ userId: "purge-3" });
    await seed(store, "sheet-anon");
    rememberOfflineUser(undefined);

    await purgeOfflineDocuments(["anon"]);

    expect(await store.load("sheet-anon")).toBeDefined();
  });
});

describe("whose documents this device holds", () => {
  /**
   * `isOfflineUser` is what keeps a cleanup somebody *else* triggered from
   * reaching this device's content. `removeMember` runs on the owner's
   * machine, and the id it names is usually not the person sitting at it.
   */
  it("answers for the account that is signed in", () => {
    rememberOfflineUser("who-1");

    expect(isOfflineUser("who-1")).toBe(true);
    expect(isOfflineUser("who-2")).toBe(false);
  });

  it("says no once nobody is signed in", () => {
    rememberOfflineUser("who-1");
    rememberOfflineUser(undefined);

    expect(isOfflineUser("who-1")).toBe(false);
  });

  it("mirrors the identity so a route without the shell can still answer", () => {
    // Sign-out is reachable from routes the authenticated shell does not
    // cover — a share link, a public page, a reload that lands outside it —
    // and there the in-memory identity is simply absent. The mirror is an id,
    // never content, and it is cleared the moment it is spent.
    rememberOfflineUser("who-3");
    expect(localStorage.getItem("wafflebase-offline-user")).toBe("who-3");

    rememberOfflineUser(undefined);
    expect(localStorage.getItem("wafflebase-offline-user")).toBeNull();
  });
});
