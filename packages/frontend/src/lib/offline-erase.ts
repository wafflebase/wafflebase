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
  if (userId !== undefined) {
    // Signing back in re-permits writing, in every tab. The denial below
    // stands for "this account's documents were just erased from this device",
    // and a fresh session is the user asking for them again.
    permitOfflineWrites(userId);
  }
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
 * Accounts whose local documents were erased, and which must therefore not be
 * written again by a client that is still mounted.
 *
 * **Per device, not per page.** This was in-memory only, on the reasoning that
 * it is a fact about this page — and that reasoning is what left the erase
 * enforced in exactly one JS realm. A second tab holding the same document is
 * a *different* realm: it never sees the set, its still-mounted durable client
 * keeps appending, the SDK repairs an append that failed against the deleted
 * base by writing a fresh snapshot, and the whole document is back on the disk
 * the sign-out was supposed to clear — with nothing left scheduled to remove
 * it. On a shared device that is the feature's primary privacy control failing
 * silently, so the denial has to travel as far as the writers do.
 *
 * `localStorage` is that reach: same-origin, shared by every tab, and read
 * synchronously at the moment of a write so a tab opened before the sign-out
 * still honours it. The in-memory set is kept in front of it as the answer
 * that works when storage is refused outright (Safari private mode) — a
 * browser in that state cannot hold a durable store to erase either, so the
 * page-local answer is the whole of the truth there.
 *
 * It is *not* a second copy of the preference: it names accounts rather than
 * devices, it is cleared the moment that account signs in again
 * ({@link rememberOfflineUser}), and the preference stays on throughout.
 */
const DENIED_KEY = "wafflebase-offline-denied";

const erased = new Set<string>();

/** The accounts this device is currently refusing to write. */
function deniedIds(): Array<string> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(DENIED_KEY);
  } catch {
    return [];
  }
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((id): id is string => typeof id === "string");
    }
  } catch {
    // Not JSON — treat it as the single id a hand-edited value would be.
    return [raw];
  }
  return [];
}

function writeDeniedIds(ids: Array<string>): void {
  try {
    if (ids.length === 0) {
      localStorage.removeItem(DENIED_KEY);
    } else {
      localStorage.setItem(DENIED_KEY, JSON.stringify([...new Set(ids)]));
    }
  } catch {
    // Same reasoning as the identity mirror: a browser that refuses storage
    // holds no durable store to erase either.
  }
}

/** Refuses further local writes for `userId`, in every tab, until they sign in again. */
function denyOfflineWrites(userId: string): void {
  erased.add(userId);
  writeDeniedIds([...deniedIds(), userId]);
}

/** Lets `userId` be written again — the sign-in that asks for their documents back. */
function permitOfflineWrites(userId: string): void {
  erased.delete(userId);
  writeDeniedIds(deniedIds().filter((id) => id !== userId));
}

/**
 * Whether this device may still write `userId`'s documents to disk.
 *
 * The companion of the erase, for the durable client to compose with the
 * preference. `dropAllForUser` deletes the entries and marks their keys, so the
 * mounted client's next append throws — and the SDK repairs a failed append by
 * writing a fresh snapshot, which puts the whole document back on the disk the
 * sign-out just cleared. The preference cannot stop that: it is still on. This
 * can — and, being read out of `localStorage`, it can do it for the tab that
 * did not perform the sign-out as well as the one that did.
 */
export function isOfflineWritePermitted(userId: string): boolean {
  if (erased.has(userId)) {
    return false;
  }
  return !deniedIds().includes(userId);
}

/**
 * The erases that were attempted and did not finish, so somebody can try again.
 *
 * Failing the erase is not rare enough to shrug at — a database that will not
 * open under storage pressure is exactly the state a full disk produces — and
 * the failure is invisible: the user is told "Logged out successfully" while
 * their documents are still on the disk. Recording the identity of the erase
 * that owes work is what gives the next session something to retry from.
 *
 * A **set** of identities, not one slot. A single slot is cleared or
 * overwritten by whichever account signs out next, and that account is by
 * definition not the one still owed an erase — so A's failed erase was
 * forgotten the moment B signed out successfully, and A's documents stayed on
 * a shared device with nothing left naming them. Each id is added when its own
 * erase fails and removed only when its own erase succeeds.
 */
const PENDING_ERASE_KEY = "wafflebase-offline-erase-pending";

/**
 * The ids currently owed an erase.
 *
 * A bare string is read as a single id: that is the shape this slot held
 * before it became a set, and a device carrying one must not have its owed
 * erase dropped by the upgrade.
 */
function pendingErases(): Array<string> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PENDING_ERASE_KEY);
  } catch {
    return [];
  }
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((id): id is string => typeof id === "string");
    }
  } catch {
    // Not JSON, so it is the one-id spelling below.
  }
  return [raw];
}

function writePendingErases(ids: Array<string>): void {
  try {
    if (ids.length === 0) {
      localStorage.removeItem(PENDING_ERASE_KEY);
    } else {
      localStorage.setItem(PENDING_ERASE_KEY, JSON.stringify([...new Set(ids)]));
    }
  } catch {
    // Same reasoning as the identity mirror: a browser that refuses storage
    // holds no durable store to erase either.
  }
}

/** Records that `userId` is still owed an erase, leaving anybody else's alone. */
function rememberPendingErase(userId: string): void {
  writePendingErases([...pendingErases(), userId]);
}

/**
 * Forgets what `userId` was owed — and only what `userId` was owed.
 *
 * Scoped on purpose: this is the half that made one slot lossy. A successful
 * sign-out says nothing about an erase another account is still owed.
 */
function forgetPendingErase(userId: string): void {
  writePendingErases(pendingErases().filter((id) => id !== userId));
}

/**
 * Erases the signed-in user's local documents, for logout to call.
 *
 * Runs whatever the preference says. The preference decides whether new
 * content is written; it says nothing about content written while it was on,
 * and leaving a signed-out account's documents on a shared machine because the
 * toggle has since been flipped would be the worst reading of it.
 *
 * Called only for a sign-out somebody *chose*, and only once the server has
 * confirmed it — see `api/auth.ts`. A session that merely expired erases
 * nothing at all: a live entry is not the disposable copy that argument once
 * assumed, it carries the un-pushed change log, so dropping it on an event the
 * user neither chose nor can undo destroys the only durable copy of work the
 * server never took.
 *
 * Never throws, and never blocks the sign-out: a logout that failed because a
 * database would not open is a worse outcome than one that left a cleanup for
 * the next session. But it does not *forget* either — the identity is spent
 * only once the erase has actually happened, and a failure is recorded so
 * {@link retryPendingOfflineErase} can finish it.
 */
export async function eraseOfflineDataOnLogout(): Promise<void> {
  const who = offlineUserId();
  if (!who) {
    rememberOfflineUser(undefined);
    return;
  }
  const store = new WafflebaseDocStore({ userId: who });
  // Refused *before* a single row is deleted, which is a separate fact from
  // the preference and an ordering rather than a detail. The page usually
  // navigates away immediately, but it need not — and a durable client is
  // still mounted over these entries for the whole of the erase. Denying only
  // afterwards leaves the entire window open: the SDK repairs an append that
  // failed against a deleted base by writing a fresh snapshot, which puts the
  // open document straight back onto the disk the sign-out is in the middle of
  // clearing, and nothing runs again to remove it. Recorded first, the client's
  // writes are refused for the duration and there is nothing racing the delete.
  //
  // It stands even if the erase below fails: this account is signed out, so
  // there is no case for writing more of their content to this device, and
  // signing back in clears it (`rememberOfflineUser`).
  denyOfflineWrites(who);
  try {
    await eraseOfflineData(store, who);
    // Forgotten only now. Clearing it first — which is what this did — made a
    // transient IndexedDB failure permanent: the identity was gone, so no later
    // logout, purge or retry could name the account whose documents were still
    // on the disk.
    rememberOfflineUser(undefined);
    forgetPendingErase(who);
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
 *
 * Every owed erase is attempted, and one that fails again keeps its place in
 * the queue: a device two accounts share can owe two, and finishing one is no
 * reason to forget the other.
 */
export async function retryPendingOfflineErase(): Promise<void> {
  const owed = pendingErases();
  if (owed.length === 0) {
    return;
  }
  for (const who of owed) {
    const store = new WafflebaseDocStore({ userId: who });
    try {
      await eraseOfflineData(store, who);
      // Only this id's marker. The recorded *identity* is whoever is signed in
      // now — by the time this runs the shell has already set it — and
      // clearing that would leave this session's own logout and purges with
      // nobody to name.
      forgetPendingErase(who);
    } catch (err) {
      console.warn("[offline] could not finish an owed erase:", err);
    } finally {
      store.close();
    }
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
 * `accessible` is the whole set the caller can read, and **an empty array is a
 * valid answer**: a user removed from their only workspace is told exactly
 * that, and it is the very case this function exists for. Refusing it — which
 * this did — declined the reconcile precisely when it was owed, on the reasoning
 * that a user with no documents has nothing stored, which is inverted here: what
 * they have stored is what they *used* to be able to read.
 *
 * So a partial or failed listing must never reach here. This deletes everything
 * outside the set, and there is now no shape of the argument that is refused.
 * The caller awaits the listing and lets a failure throw before calling at all;
 * that `catch` is the whole guard.
 *
 * Archives go with it, unlike a deletion's purge. Recovery turns an archive
 * into a whole new document, so keeping one for a workspace the user was
 * removed from would hand them a permanent copy of content they may no longer
 * read.
 *
 * Unlike every other purge here, this one deletes on an *absence* — and an
 * absence has innocent causes. The database is shared with this user's other
 * tabs, so a document created or opened in one of them after the listing was
 * taken is missing from that listing for no reason at all. `listedAt` and
 * `isOpenElsewhere` are what keep those: an entry a client has open right now,
 * or one touched since the question was asked, is not evidence of lost access.
 * Both are optional so a caller with no clock or no lock registry still gets
 * the reconcile, just without the guards.
 */
export async function purgeRevokedOfflineDocuments(
  accessible: Array<string>,
  options: {
    /** When the listing was requested; entries touched since are spared. */
    listedAt?: number;
    /** Whether a document key is open in some tab right now. */
    isOpenElsewhere?: (docKey: string) => Promise<boolean> | boolean;
  } = {},
): Promise<number> {
  const who = offlineUserId();
  if (!who) {
    // Nobody to reconcile for.
    return 0;
  }
  const store = new WafflebaseDocStore({
    userId: who,
    isOpenElsewhere: options.isOpenElsewhere,
  });
  try {
    const keep = new Set(accessible);
    // Archives as well as live entries, and that is not a detail: `remove()`
    // deletes the header and writes the content into a separate store, so a
    // document that hit `LocalChangesDropped` is invisible to the header index
    // this used to enumerate alone. It was therefore structurally unreachable
    // here — a full snapshot of a workspace's document, kept past the
    // revocation, and then *offered back* as a new document the removed user
    // owns.
    const revoked = (await store.storedDocumentIds({ archives: true })).filter(
      (id) => !keep.has(id),
    );
    let purged = 0;
    for (const id of revoked) {
      purged += await store.purgeDocument(id, {
        archives: "drop",
        skipOpen: true,
        updatedSince: options.listedAt,
      });
    }
    return purged;
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
