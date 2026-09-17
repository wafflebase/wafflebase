import type { WafflebaseDocStore } from "./wafflebase-doc-store";
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
): Promise<void> {
  await store.dropAllForUser(userId);
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

    const current = store();
    const who = userId();
    if (!current || !who) {
      return;
    }

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
