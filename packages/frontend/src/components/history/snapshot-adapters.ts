import { YSON } from '@yorkie-js/sdk';
import type { SpreadsheetDocument } from '@wafflebase/sheets';
import type { SlidesDocument } from '@wafflebase/slides';

/**
 * A revision snapshot is YSON: JSON plus constructor-wrapped CRDT values
 * (`Text([...])`, `Tree({...})`). For sheets, slides and board the root is
 * plain JSON, so parsing is the whole conversion — the backend's `read*Root`
 * helpers exist to unwrap *live* Yorkie proxies and have no job here.
 *
 * `YSON.parse`'s preprocessor is regex-based and throws once a `Tree(...)`
 * nests past three brace levels, which every wafflebase docs document does
 * (`doc > block > inline > text` is depth 4). Docs snapshots are therefore
 * unparsable until that upstream limit is fixed; callers must handle the
 * throw.
 */
export function parseSheetSnapshot(snapshot: string): SpreadsheetDocument {
  return YSON.parse<SpreadsheetDocument>(snapshot);
}

export function parseSlidesSnapshot(snapshot: string): SlidesDocument {
  return YSON.parse<SlidesDocument>(snapshot);
}

/** A board is one synthetic slide, so it shares the slides shape. */
export const parseBoardSnapshot = parseSlidesSnapshot;

export function parseNoteSnapshot(snapshot: string): string {
  const root = YSON.parse<{ content?: YSON.Text }>(snapshot);
  return root.content ? YSON.textToString(root.content) : '';
}
