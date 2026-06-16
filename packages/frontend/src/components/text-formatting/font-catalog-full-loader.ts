/**
 * Lazy loader for the full Google Fonts library (`font-catalog.full.ts`,
 * ~1,900 families). The `import()` makes it a separate chunk that only
 * downloads when a user opens the "More fonts…" dialog, keeping it out
 * of the main editor bundle.
 *
 * Memoized: the in-flight/resolved promise is reused so repeated opens
 * don't re-fetch. A failed load clears the memo so a later open retries.
 */
import type { FontEntry } from "./font-catalog";

let promise: Promise<readonly FontEntry[]> | null = null;

export function loadFullFontCatalog(): Promise<readonly FontEntry[]> {
  if (!promise) {
    promise = import("./font-catalog.full")
      .then((m) => m.FONT_CATALOG_FULL)
      .catch((err) => {
        promise = null;
        throw err;
      });
  }
  return promise;
}
