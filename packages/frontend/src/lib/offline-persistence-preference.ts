import { useSyncExternalStore } from "react";

/**
 * Whether documents opened on *this device* keep their un-sent edits locally,
 * so they survive a reload or a crash while offline.
 *
 * Off by default, and deliberately per device rather than per account:
 * persisting writes document content to the disk of whatever machine the user
 * is on, where it outlives the session. An account-level setting would follow
 * the user onto a shared machine and re-enable there — precisely the case the
 * toggle exists to prevent. So this is `localStorage`, like the other
 * preferences in Settings, and not a column on `User`.
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
 * Session-only copy of the preference, set *only* when persisting it failed.
 * It keeps a choice made in an environment without writable storage applied
 * for the rest of the session — it just does not survive a reload.
 *
 * A successful write clears it back to `null` so storage stays the single
 * source of truth: otherwise a stale mirror would outvote a key that another
 * tab has since changed or cleared.
 */
let memoryEnabled: boolean | null = null;

/** The stored preference, falling back to off on absent/junk values. */
export function getOfflinePersistenceEnabled(): boolean {
  // The mirror is only non-null when the last write failed, so storage is
  // known to be stale (it may still *read* fine and hold the previous value —
  // `setItem` throws QuotaExceededError on its own, e.g. full storage or iOS
  // Safari private mode, while `getItem` keeps working). Prefer the mirror
  // there; with storage healthy it is null and this costs nothing.
  if (memoryEnabled !== null) return memoryEnabled;
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    // Touching `localStorage` throws outright (SecurityError) in Safari
    // private mode, with third-party/blocked storage, and in sandboxed
    // iframes. This function is the `useSyncExternalStore` snapshot, so it
    // runs during render — a throw here would blank the page rather than lose
    // a preference. Reading as off is also the safe direction: a browser that
    // refuses storage cannot give us a durable store either.
    return DEFAULT_OFFLINE_PERSISTENCE;
  }
}

/** Persist the preference and notify every subscriber in this tab. */
export function setOfflinePersistenceEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
    memoryEnabled = null;
  } catch {
    // Same environments as above, plus a full quota. Throwing out of the
    // Settings `Switch`'s `onCheckedChange` would leave the control showing
    // the old value with no explanation; degrading to a session-only
    // preference is the graceful failure.
    memoryEnabled = enabled;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Subscribes to preference changes from this tab or another one. Exported
 * because the consumer is not only React: the document client decides whether
 * to open a store outside the render tree.
 */
export function subscribeOfflinePersistence(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Reads the offline persistence preference, re-rendering when it changes —
 * including when it changes from another component (Settings) or another tab.
 */
export function useOfflinePersistenceEnabled(): boolean {
  return useSyncExternalStore(
    subscribeOfflinePersistence,
    getOfflinePersistenceEnabled,
    () => DEFAULT_OFFLINE_PERSISTENCE,
  );
}
