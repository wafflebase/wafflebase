import { useSyncExternalStore } from "react";

/**
 * How the documents list renders its Modified / Created columns.
 *
 * - `relative` — "about 1 month ago" (the historical behavior, and the
 *   default).
 * - `exact` — a locale-formatted calendar date, e.g. "Jul 25".
 *
 * Either way the cell also carries the full localized date + time as its
 * tooltip, so the exact timestamp is always one hover away.
 */
export type DateDisplayFormat = "relative" | "exact";

export const DEFAULT_DATE_FORMAT: DateDisplayFormat = "relative";

const STORAGE_KEY = "wafflebase-date-format";

/**
 * Same-tab change notification. `storage` only fires in *other* tabs, so the
 * Settings page and the documents list — separate route trees in the same
 * tab — need their own event to stay in sync.
 */
const CHANGE_EVENT = "wafflebase-date-format-change";

function isFormat(value: unknown): value is DateDisplayFormat {
  return value === "relative" || value === "exact";
}

/**
 * Session-only copy of the preference, set *only* when persisting it failed.
 * It keeps a choice made in an environment without writable storage applied
 * for the rest of the session — it just does not survive a reload.
 *
 * A successful write clears it back to `null` so storage stays the single
 * source of truth: otherwise a stale mirror would outvote a key that another
 * tab has since changed or cleared.
 */
let memoryFormat: DateDisplayFormat | null = null;

/** The stored preference, falling back to the default on absent/junk values. */
export function getDateFormat(): DateDisplayFormat {
  // The mirror is only non-null when the last write failed, so storage is
  // known to be stale (it may still *read* fine and hold the previous value —
  // `setItem` throws QuotaExceededError on its own, e.g. full storage or iOS
  // Safari private mode, while `getItem` keeps working). Prefer the mirror
  // there; with storage healthy it is null and this costs nothing.
  if (memoryFormat !== null) return memoryFormat;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isFormat(stored)) return stored;
  } catch {
    // Touching `localStorage` throws outright (SecurityError) in Safari
    // private mode, with third-party/blocked storage, and in sandboxed
    // iframes. This function is the `useSyncExternalStore` snapshot, so it
    // runs during render of the documents list — a throw here would blank
    // the whole list rather than lose a display preference.
  }
  return DEFAULT_DATE_FORMAT;
}

/** Persist the preference and notify every subscriber in this tab. */
export function setDateFormat(format: DateDisplayFormat): void {
  try {
    localStorage.setItem(STORAGE_KEY, format);
    memoryFormat = null;
  } catch {
    // Same environments as above, plus a full quota. Throwing out of the
    // Settings `Select`'s `onValueChange` would leave the control showing the
    // old value with no explanation; degrading to a session-only preference
    // is the graceful failure.
    memoryFormat = format;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Reads the date display preference, re-rendering when it changes — including
 * when it changes from another component (Settings) or another tab.
 */
export function useDateFormat(): DateDisplayFormat {
  return useSyncExternalStore(subscribe, getDateFormat, () => {
    return DEFAULT_DATE_FORMAT;
  });
}
