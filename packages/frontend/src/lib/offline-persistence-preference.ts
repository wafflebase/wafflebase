import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether documents opened on *this device* keep their un-sent edits locally,
 * so they survive a reload or a crash while offline.
 *
 * Off by default, and stored per device — never on the account. Persisting
 * writes document content to the disk of whatever machine the user is on,
 * where it outlives the session, so an account-level setting would follow the
 * user onto a shared machine and re-enable there: precisely the case the toggle
 * exists to prevent. Hence `localStorage`, like the other preferences in
 * Settings, and not a column on `User`.
 *
 * **Per device _and_ per account, not per device alone.** A single unqualified
 * key answers for whoever is sitting at the machine, which on the shared device
 * this feature is careful about is the wrong person: one user opting in would
 * silently start writing the *next* user's document content to that disk,
 * without that account ever being asked and with a Settings switch that shows
 * "on" for a choice they did not make. So the stored value is the set of
 * accounts that have consented **on this device**, and every read names the
 * account it is asking for. An account that has not consented here reads off,
 * and an unknown account reads off too — the safe direction, since nothing can
 * be attributed to nobody.
 *
 * Turning it off erases what was stored; see
 * `docs/design/offline-local-persistence.md` § Turning it on.
 */
export const DEFAULT_OFFLINE_PERSISTENCE = false;

const STORAGE_KEY = "wafflebase-offline-persistence";

/**
 * Same-tab change notification. `storage` only fires in *other* tabs, so the
 * Settings page and an open editor — separate route trees in the same tab —
 * need their own event to stay in sync.
 */
const CHANGE_EVENT = "wafflebase-offline-persistence-change";

/**
 * Session-only copy of the consenting accounts, set *only* when persisting them
 * failed. It keeps a choice made in an environment without writable storage
 * applied for the rest of the session — it just does not survive a reload.
 *
 * A successful write clears it back to `null` so storage stays the single
 * source of truth: otherwise a stale mirror would outvote a key that another
 * tab has since changed or cleared.
 */
let memoryConsent: Array<string> | null = null;

/**
 * The stored ids, tolerating every shape that is not one.
 *
 * Anything unparseable — junk, or the bare `"true"` an earlier unqualified
 * spelling of this key would have written — reads as *nobody consented*. That
 * is the only safe reading: a device-wide `true` names no account, and honoring
 * it for whoever happens to be signed in is the very leak the per-account set
 * exists to close.
 */
function parseConsent(raw: string | null): Array<string> {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((id): id is string => typeof id === "string");
    }
  } catch {
    // Not JSON. Nobody consented.
  }
  return [];
}

/** The accounts that have opted in on this device. */
function consentingIds(): Array<string> {
  // The mirror is only non-null when the last write failed, so storage is
  // known to be stale (it may still *read* fine and hold the previous value —
  // `setItem` throws QuotaExceededError on its own, e.g. full storage or iOS
  // Safari private mode, while `getItem` keeps working). Prefer the mirror
  // there; with storage healthy it is null and this costs nothing.
  if (memoryConsent !== null) {
    return memoryConsent;
  }
  try {
    return parseConsent(localStorage.getItem(STORAGE_KEY));
  } catch {
    // Touching `localStorage` throws outright (SecurityError) in Safari
    // private mode, with third-party/blocked storage, and in sandboxed
    // iframes. This feeds the `useSyncExternalStore` snapshot, so it runs
    // during render — a throw here would blank the page rather than lose a
    // preference. Reading as off is also the safe direction: a browser that
    // refuses storage cannot give us a durable store either.
    return [];
  }
}

/**
 * Whether `userId` opted into offline saving **on this device**.
 *
 * An absent identity reads as off. Every caller either knows who is signed in
 * or is in no position to persist anything for them.
 */
export function getOfflinePersistenceEnabled(
  userId: string | undefined,
): boolean {
  if (!userId) {
    return DEFAULT_OFFLINE_PERSISTENCE;
  }
  return consentingIds().includes(userId);
}

/**
 * Whether **anybody** has opted in on this device.
 *
 * The one question that can be answered without an identity, and it exists for
 * the one caller that has to decide something before the identity resolves: a
 * mounting editor must not settle "not durable" while it is still learning who
 * is signed in, because that decision is latched for the life of the open
 * document. With nobody consented here the answer cannot become yes whoever
 * arrives, so waiting would put a blank frame in front of a feature that is
 * switched off — which is every device that has never used it.
 */
export function hasOfflinePersistenceConsent(): boolean {
  return consentingIds().length > 0;
}

/**
 * Records `userId`'s choice on this device and notifies every subscriber in
 * this tab.
 *
 * Only ever adds or removes that one id: another account's consent on a shared
 * machine is theirs, and turning mine off is not a statement about it.
 */
export function setOfflinePersistenceEnabled(
  userId: string,
  enabled: boolean,
): void {
  const current = consentingIds();
  const next = enabled
    ? [...new Set([...current, userId])]
    : current.filter((id) => id !== userId);
  try {
    if (next.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
    memoryConsent = null;
  } catch {
    // Same environments as above, plus a full quota. Throwing out of the
    // Settings `Switch`'s `onCheckedChange` would leave the control showing
    // the old value with no explanation; degrading to a session-only
    // preference is the graceful failure.
    memoryConsent = next;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Subscribes to preference changes from this tab or another one. Exported
 * because the consumer is not only React: the document client decides whether
 * to open a store outside the render tree.
 */
/**
 * Another tab changing our key retires the mirror.
 *
 * The mirror holds a value *we* could not write. Once another tab has written
 * one, that is a real answer and ours is a guess about storage that would not
 * take it — so keeping the guess makes every reader contradict the event it is
 * reacting to, and only a reload settles it.
 *
 * Registered once at module scope rather than inside `subscribe`, because the
 * mirror going stale has nothing to do with whether anybody happens to be
 * listening: a reader that never subscribed would otherwise keep answering the
 * guess forever. A `null` key is the whole area being cleared, which includes
 * ours; another key says nothing about ours.
 */
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === STORAGE_KEY) {
      memoryConsent = null;
    }
  });
}

export function subscribeOfflinePersistence(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Reads `userId`'s offline persistence preference, re-rendering when it changes
 * — including when it changes from another component (Settings) or another tab.
 */
export function useOfflinePersistenceEnabled(
  userId: string | undefined,
): boolean {
  const snapshot = useCallback(
    () => getOfflinePersistenceEnabled(userId),
    [userId],
  );
  return useSyncExternalStore(
    subscribeOfflinePersistence,
    snapshot,
    () => DEFAULT_OFFLINE_PERSISTENCE,
  );
}
