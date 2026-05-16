/**
 * Yorkie root <-> slides `SlidesDocument` serialization for the backend.
 *
 * Unlike docs (whose body is a Yorkie `Tree` CRDT), slides bodies live as
 * plain JSON on the Yorkie root. The frontend's `slides-view.tsx` writes
 * imported decks by direct property assignment on the root proxy:
 *
 *     doc.update((r) => {
 *       r.meta = { title, themeId, masterId };
 *       r.themes = ...;
 *       r.masters = ...;
 *       r.layouts = ...;
 *       r.slides = ...;
 *     });
 *
 * This module mirrors that pattern for backend callers (the v1 REST
 * content endpoint). The contract is **destructive replace** — incoming
 * fields overwrite whatever is on the root, and `meta` is rewritten as a
 * fresh object so stale theme/master ids cannot leak from a prior write.
 */
import type { Master, Theme } from '@wafflebase/slides';
import type {
  SlidesDocument,
  SlidesLayout,
  SlidesSlide,
} from './yorkie.types';

/**
 * The Yorkie root shape used by slides documents. Mirrors
 * `frontend/src/types/slides-document.ts#YorkieSlidesRoot` but keeps
 * every field optional so a freshly-attached (empty) document is
 * representable.
 */
export interface SlidesYorkieRoot extends Record<string, unknown> {
  meta?: { title: string; themeId?: string; masterId?: string };
  themes?: Theme[];
  masters?: Master[];
  layouts?: SlidesLayout[];
  slides?: SlidesSlide[];
}

/**
 * Read the Yorkie root for a slides document and return the canonical
 * `SlidesDocument` JSON shape. Returns a deck with empty theme/master/
 * layout/slide arrays and a default `meta` if the root has not been
 * initialised yet — matches what `ensureSlidesRoot` would backfill on
 * the frontend so callers can treat the response uniformly.
 */
export function readSlidesRoot(root: SlidesYorkieRoot): SlidesDocument {
  // Apply unwrapJson uniformly: Yorkie returns object proxies whose
  // toJSON yields a JSON string. Primitives (e.g. `meta.title`) read
  // through the proxy directly, but unwrapping the object once up
  // front gives a plain JS object that round-trips through
  // JSON.stringify without double-encoding — same shape as the docs
  // reader's `readPageSetup`.
  const metaSrc = unwrapJson<{
    title: string;
    themeId?: string;
    masterId?: string;
  }>(root.meta);
  const themes = unwrapJson<Theme[]>(root.themes) ?? [];
  const masters = unwrapJson<Master[]>(root.masters) ?? [];
  const layouts = unwrapJson<SlidesLayout[]>(root.layouts) ?? [];
  const slides = unwrapJson<SlidesSlide[]>(root.slides) ?? [];
  return {
    meta: {
      title: metaSrc?.title ?? 'Untitled presentation',
      themeId: metaSrc?.themeId ?? (themes[0]?.id ?? 'default-light'),
      masterId: metaSrc?.masterId ?? (masters[0]?.id ?? 'default'),
    },
    themes,
    masters,
    layouts,
    slides,
  };
}

/**
 * Replace the entire slides root with the given `SlidesDocument`.
 * Caller must invoke this inside a `doc.update(root => …)` block.
 *
 * **Destructive contract:** every top-level slides field on the root
 * (`meta`, `themes`, `masters`, `layouts`, `slides`) is overwritten.
 * Concurrent collaborator edits made between the read and the write
 * may be lost — this is a last-write-wins primitive, used by the
 * CLI's import flow which already opts in to that semantic.
 */
export function writeSlidesRoot(
  root: SlidesYorkieRoot,
  document: SlidesDocument,
): void {
  root.meta = {
    title: document.meta.title,
    themeId: document.meta.themeId,
    masterId: document.meta.masterId,
  };
  root.themes = document.themes;
  root.masters = document.masters;
  root.layouts = document.layouts;
  root.slides = document.slides;
}

/**
 * Yorkie object proxies serialise via a `toJSON()` method that returns a
 * JSON *string* (not a plain object). Spread / JSON.stringify therefore
 * double-encode. This helper detects the proxy shape and parses back to
 * a plain JS value; plain inputs (or `undefined`) pass through.
 */
function unwrapJson<T>(value: unknown): T | undefined {
  if (value == null) return undefined;
  if (typeof value === 'object') {
    const maybeJson = (value as { toJSON?: () => string }).toJSON;
    if (typeof maybeJson === 'function') {
      const str = maybeJson.call(value);
      if (typeof str === 'string') {
        return JSON.parse(str) as T;
      }
    }
  }
  return value as T;
}
