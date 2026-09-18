import { WafflebaseDocStore } from "./wafflebase-doc-store";
import {
  getOfflinePersistenceEnabled,
  subscribeOfflinePersistence,
} from "./offline-persistence-preference";

/**
 * Keeping the promise the Settings toggle makes.
 *
 * Its copy says, of offline saving: "turning this off deletes them." That
 * sentence is the product of this module. A toggle that leaves the content
 * behind is not the control it presents itself as — and what it would leave is
 * document text on a disk the user has just said they did not want it on.
 *
 * Design: `docs/design/offline-local-persistence.md` § Turning it on.
 */

/**
 * Removes everything this user has stored locally: live entries and the
 * archives `remove` kept.
 *
 * Scoped to the user, never to the database. Turning *my* setting off says
 * nothing about another account's documents, and a shared machine is exactly
 * the case this feature is careful about.
 */
export async function eraseOfflineData(
  store: WafflebaseDocStore,
  userId: string,
  options: { keepArchives?: boolean } = {},
): Promise<void> {
  await store.dropAllForUser(userId, options);
}

/**
 * Who the erase on sign-out is for.
 *
 * Logout is the one cleanup trigger with no identity of its own to work from:
 * `logout()` clears the session cookie and knows nothing about the user it just
 * signed out, and by the time anything could ask, `/auth/me` answers 401. So
 * the authenticated shell records the identity while it has one, and logout
 * spends it.
 *
 * Module state rather than a React ref because the caller is `api/auth.ts`,
 * which is reached from outside the tree — including from `fetchWithAuth`'s
 * 401 arm, where no component is in a position to run anything.
 *
 * And mirrored into `localStorage`, because module state only exists where the
 * authenticated shell is mounted. Sign-out is reachable from routes it does
 * not cover — a share link, a public page, a reload that lands outside it —
 * and there the in-memory identity is simply absent, so the erase would
 * silently do nothing and leave document content on a shared device. The
 * mirror is an id, never content, and it is cleared the moment it is spent.
 */
const LAST_USER_KEY = "wafflebase-offline-user";

let signedInUserId: string | undefined;

/**
 * Records who is signed in, for {@link eraseOfflineDataOnLogout}.
 *
 * Passing `undefined` is an explicit *forget* — "nobody is signed in on this
 * device" — and clears the mirror too. It is deliberately not what an
 * unmounting shell does: a component going away is not a sign-out, and
 * clearing there is precisely what made the erase a no-op everywhere the shell
 * is not.
 */
export function rememberOfflineUser(userId: string | undefined): void {
  signedInUserId = userId;
  try {
    if (userId === undefined) {
      localStorage.removeItem(LAST_USER_KEY);
    } else {
      localStorage.setItem(LAST_USER_KEY, userId);
    }
  } catch {
    // Storage may be refused outright (Safari private mode, blocked
    // third-party storage). The in-memory identity still covers the ordinary
    // case, and a browser that refuses storage cannot hold a durable store to
    // erase either.
  }
}

/** Who this device's stored documents belong to, if anyone. */
function offlineUserId(): string | undefined {
  if (signedInUserId !== undefined) {
    return signedInUserId;
  }
  try {
    return localStorage.getItem(LAST_USER_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether `userId` is the account whose documents this device holds.
 *
 * For the callers that lose access on somebody else's behalf: removing another
 * member from a workspace must not purge *this* user's copies of documents
 * they still have every right to read.
 */
export function isOfflineUser(userId: string): boolean {
  return offlineUserId() === userId;
}

/**
 * An erase that was attempted and did not finish, so somebody can try again.
 *
 * Failing the erase is not rare enough to shrug at — a database that will not
 * open under storage pressure is exactly the state a full disk produces — and
 * the failure is invisible: the user is told "Logged out successfully" while
 * their documents are still on the disk. Recording the identity of the erase
 * that owes work is what gives the next session something to retry from.
 */
const PENDING_ERASE_KEY = "wafflebase-offline-erase-pending";

function rememberPendingErase(userId: string | undefined): void {
  try {
    if (userId === undefined) {
      localStorage.removeItem(PENDING_ERASE_KEY);
    } else {
      localStorage.setItem(PENDING_ERASE_KEY, userId);
    }
  } catch {
    // Same reasoning as the identity mirror: a browser that refuses storage
    // holds no durable store to erase either.
  }
}

/**
 * Erases the signed-in user's local documents, for logout to call.
 *
 * Runs whatever the preference says. The preference decides whether new
 * content is written; it says nothing about content written while it was on,
 * and leaving a signed-out account's documents on a shared machine because the
 * toggle has since been flipped would be the worst reading of it.
 *
 * `keepArchives` is for the involuntary case — a session the server expired.
 * The live entries go either way, because they are copies of content the server
 * still holds and a shared disk should not keep them; the archives are the only
 * copy of work the server never took, so an event the user neither chose nor
 * can undo must not delete them.
 *
 * Never throws, and never blocks the sign-out: a logout that failed because a
 * database would not open is a worse outcome than one that left a cleanup for
 * the next session. But it does not *forget* either — the identity is spent
 * only once the erase has actually happened, and a failure is recorded so
 * {@link retryPendingOfflineErase} can finish it.
 */
export async function eraseOfflineDataOnLogout(
  options: { keepArchives?: boolean } = {},
): Promise<void> {
  const who = offlineUserId();
  if (!who) {
    rememberOfflineUser(undefined);
    return;
  }
  const store = new WafflebaseDocStore({ userId: who });
  try {
    await eraseOfflineData(store, who, options);
    // Forgotten only now. Clearing it first — which is what this did — made a
    // transient IndexedDB failure permanent: the identity was gone, so no later
    // logout, purge or retry could name the account whose documents were still
    // on the disk.
    if (options.keepArchives) {
      // The archives were spared on purpose, and they are this user's. Keeping
      // the identity is what lets a later deliberate sign-out erase them, and
      // what lets the recovery UI still find them when they sign back in.
      rememberPendingErase(undefined);
    } else {
      rememberOfflineUser(undefined);
      rememberPendingErase(undefined);
    }
  } catch (err) {
    console.warn("[offline] could not erase local documents on logout:", err);
    // Left recorded on purpose: the retry needs a name, and this is the only
    // place that still has one.
    rememberPendingErase(who);
  } finally {
    store.close();
  }
}

/**
 * Finishes an erase a previous sign-out could not, if one is owed.
 *
 * Called from the authenticated shell on mount — including by a *different*
 * account signing in on the same device, which is the case the retry is for.
 * Silent: nobody asked for this now, and there is nothing actionable to say.
 */
export async function retryPendingOfflineErase(): Promise<void> {
  let owed: string | null = null;
  try {
    owed = localStorage.getItem(PENDING_ERASE_KEY);
  } catch {
    return;
  }
  if (!owed) {
    return;
  }
  const store = new WafflebaseDocStore({ userId: owed });
  try {
    await eraseOfflineData(store, owed);
    // Only the marker. The recorded identity is whoever is signed in *now* —
    // by the time this runs the shell has already set it — and clearing it
    // would leave this session's own logout and purges with nobody to name.
    rememberPendingErase(undefined);
  } catch (err) {
    console.warn("[offline] could not finish an owed erase:", err);
  } finally {
    store.close();
  }
}

/**
 * Drops whatever this device holds for documents that are gone.
 *
 * The other half of the design's cleanup table: content must not outlive the
 * authority to read it, and a deleted document is the clearest case of losing
 * that authority. Archives are deliberately spared — see
 * `WafflebaseDocStore.purgeDocument`.
 *
 * Silent and best effort. This is called after a delete the server has already
 * accepted, so failing it would report a successful deletion as an error.
 */
export async function purgeOfflineDocuments(
  documentIds: Array<string>,
  options: { dropArchives?: boolean } = {},
): Promise<void> {
  const who = offlineUserId();
  if (!who || documentIds.length === 0) {
    return;
  }
  const store = new WafflebaseDocStore({ userId: who });
  try {
    for (const id of documentIds) {
      await store.purgeDocument(id, {
        archives: options.dropArchives ? "drop" : "keep",
      });
    }
  } catch (err) {
    console.warn("[offline] could not drop local copies of a document:", err);
  } finally {
    store.close();
  }
}

/**
 * Drops what this device holds for documents the server no longer lists.
 *
 * The cleanup for access somebody *else* ended. Every other purge here runs on
 * the device of whoever made the request — an owner removing a member, a user
 * deleting a document — and the removed member's own device is reached by none
 * of them: no API call happens there, and nothing tells it anything until it
 * next asks. So it asks, once per session, and keeps only what the server still
 * lists for it.
 *
 * `accessible` is the whole set the caller can read. A partial or failed
 * listing must never reach here: this deletes everything outside the set, so an
 * empty list would erase the device. The caller's `catch` is what enforces
 * that, and the guard below makes the dangerous shape unrunnable anyway.
 *
 * Archives go with it, unlike a deletion's purge. Recovery turns an archive
 * into a whole new document, so keeping one for a workspace the user was
 * removed from would hand them a permanent copy of content they may no longer
 * read.
 */
export async function purgeRevokedOfflineDocuments(
  accessible: Array<string>,
): Promise<number> {
  const who = offlineUserId();
  if (!who || accessible.length === 0) {
    // Nothing to compare against. A user who genuinely has no documents has
    // nothing stored either, so declining here costs nothing and refuses the
    // one input shape that would erase the device on a half-answered list.
    return 0;
  }
  const store = new WafflebaseDocStore({ userId: who });
  try {
    const keep = new Set(accessible);
    const revoked = (await store.storedDocumentIds()).filter(
      (id) => !keep.has(id),
    );
    for (const id of revoked) {
      await store.purgeDocument(id, { archives: "drop" });
    }
    return revoked.length;
  } catch (err) {
    console.warn("[offline] could not reconcile local copies:", err);
    return 0;
  } finally {
    store.close();
  }
}

/**
 * Erases when the preference is switched off, for as long as the returned
 * function is not called.
 *
 * `store` and `userId` are read at the moment it fires rather than captured
 * here: the watcher outlives a sign-out and sign-in, and erasing the account
 * that happened to be signed in when it was set up would be the same harm it
 * exists to prevent.
 */
export function watchForOfflineDisable(
  store: () => WafflebaseDocStore | undefined,
  userId: () => string | undefined,
): () => void {
  // Settings is its own route: switching the toggle off is the one moment when
  // *no* editor is mounted, so asking for the open store and giving up when
  // there is none skips the erase precisely when it is requested — and spends
  // the edge doing it, since the preference is now off and no later change
  // fires again. "Turning this off deletes them" would quietly reduce to the
  // thirty-day sweep.
  // The listener fires on both edges, so the previous value is what tells them
  // apart. Erasing on the *enabling* edge would delete the documents the user
  // just asked to start keeping.
  let wasEnabled = getOfflinePersistenceEnabled();

  return subscribeOfflinePersistence(() => {
    const enabled = getOfflinePersistenceEnabled();
    const turnedOff = wasEnabled && !enabled;
    wasEnabled = enabled;
    if (!turnedOff) {
      return;
    }

    const who = userId();
    if (!who) {
      // Nobody to erase for. Signed out already, which means logout's own
      // cleanup either ran or never had an identity to run under.
      return;
    }

    // Falls back to a store of its own rather than declining: the database name
    // is fixed, so one can always be opened, and the work is the same either
    // way.
    const current = store() ?? new WafflebaseDocStore({ userId: who });

    // Deliberately not awaited by the caller, and deliberately swallowing.
    // This runs from a preference setter invoked by a switch's change handler:
    // the user asked for it to stop saving, and that answer stands whether or
    // not the cleanup succeeded. Re-enabling the setting to match the disk
    // would be the control fighting the person using it. What is left behind
    // is reached by the thirty-day collection instead.
    void eraseOfflineData(current, who).catch((err) => {
      console.warn("[offline] could not erase local documents:", err);
    });
  });
}
