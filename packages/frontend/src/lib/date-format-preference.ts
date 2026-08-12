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

/** The stored preference, falling back to the default on absent/junk values. */
export function getDateFormat(): DateDisplayFormat {
  const stored = localStorage.getItem(STORAGE_KEY);
  return isFormat(stored) ? stored : DEFAULT_DATE_FORMAT;
}

/** Persist the preference and notify every subscriber in this tab. */
export function setDateFormat(format: DateDisplayFormat): void {
  localStorage.setItem(STORAGE_KEY, format);
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
