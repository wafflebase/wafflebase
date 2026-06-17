/**
 * Recently-used font families, persisted per browser in localStorage.
 *
 * Powers the "Recent" section at the top of the font picker so a family
 * chosen from the "More fonts…" dialog resurfaces without re-searching.
 * Browser-scoped and app-agnostic (Docs + Slides share it); per-document
 * "fonts used in this file" persistence (Yorkie meta) is a separate,
 * app-specific concern tracked as a follow-up.
 *
 * All reads/writes are defensive: storage may be unavailable (SSR,
 * privacy mode) or hold stale/corrupt values, and a font picker must
 * never throw because of it.
 */

const KEY = 'wafflebase:recent-fonts';

/** Hard cap on the stored list — keeps the picker's Recent section short
 *  and the serialized value tiny. */
export const RECENT_FONTS_MAX = 8;

function readStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    // Accessing localStorage can throw (e.g. blocked third-party storage).
    return null;
  }
}

/** Most-recent-first list of family names. Always returns a fresh array
 *  of strings; never throws. */
export function getRecentFonts(): string[] {
  const store = readStorage();
  if (!store) return [];
  const raw = store.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Cap on read too: a stale/hand-edited value could exceed the cap and
    // make the Recent section unbounded despite the write-side limit.
    return parsed
      .filter((x): x is string => typeof x === 'string')
      .slice(0, RECENT_FONTS_MAX);
  } catch {
    return [];
  }
}

/** Record `family` as most-recently-used: prepend, de-dup, cap. No-op
 *  when storage is unavailable. */
export function addRecentFont(family: string): void {
  const store = readStorage();
  if (!store) return;
  const next = [family, ...getRecentFonts().filter((f) => f !== family)].slice(
    0,
    RECENT_FONTS_MAX,
  );
  try {
    store.setItem(KEY, JSON.stringify(next));
  } catch {
    // Quota or serialization failure — drop silently; recents are a
    // nicety, not a correctness requirement.
  }
}
