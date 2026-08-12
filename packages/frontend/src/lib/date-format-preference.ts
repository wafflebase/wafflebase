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
 * In-memory mirror of the preference, consulted only when `localStorage` is
 * unreadable or unwritable. It keeps a choice made in an environment without
 * storage applied for the rest of the session — it just does not survive a
 * reload.
 */
let memoryFormat: DateDisplayFormat | null = null;

/** The stored preference, falling back to the default on absent/junk values. */
export function getDateFormat(): DateDisplayFormat {
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
  return memoryFormat ?? DEFAULT_DATE_FORMAT;
}

/** Persist the preference and notify every subscriber in this tab. */
export function setDateFormat(format: DateDisplayFormat): void {
  // Set before the write so the preference still applies when storage is
  // unavailable: `getDateFormat` reads storage first and falls back here.
  memoryFormat = format;
  try {
    localStorage.setItem(STORAGE_KEY, format);
  } catch {
    // Same environments as above. Throwing out of the Settings `Select`'s
    // `onValueChange` would leave the control showing the old value with no
    // explanation; degrading to a session-only preference is the graceful
    // failure.
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
