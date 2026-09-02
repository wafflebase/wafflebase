import { YSON } from '@yorkie-js/sdk';
import type { SpreadsheetDocument } from '@wafflebase/sheets';
import type { Element, SlidesDocument } from '@wafflebase/slides';
import { boardToSlidesDocument } from '@wafflebase/board';
import type { YorkieBoardRoot } from '@/types/board-document';

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

/**
 * A board *renders* as one synthetic slide, but it is not stored as one.
 * The persisted `board-<id>` root is `{meta, elements}` (`YorkieBoardRoot`);
 * the synthetic slide — along with the themes, masters and layouts the
 * slides renderer needs — is manufactured at read time by
 * `boardToSlidesDocument`, exactly as `YorkieBoardStore.read()` does for the
 * live document.
 *
 * Aliasing this to {@link parseSlidesSnapshot} therefore produced a
 * `SlidesDocument` with no `slides` at all — and, because that is a missing
 * key rather than a parse error, it rendered as a blank canvas under a
 * banner naming a date instead of raising anything the preview could report.
 */
export function parseBoardSnapshot(snapshot: string): SlidesDocument {
  const root = YSON.parse<Partial<YorkieBoardRoot>>(snapshot);
  return boardToSlidesDocument({
    // Mirrors `YorkieBoardStore.read()`'s defaults: a board that was never
    // edited has no `meta` at all (a viewer attaches with an empty initial
    // root — see `boardInitialRootForRole`).
    meta: {
      title: root.meta?.title ?? 'Untitled board',
      unit: root.meta?.unit,
      recentColors: root.meta?.recentColors,
    },
    // A parsed snapshot is plain JSON, so these are already the plain
    // `Element` objects the model wants — no proxy unwrapping to do.
    elements: (root.elements ?? []) as unknown as Element[],
  });
}

export function parseNoteSnapshot(snapshot: string): string {
  const root = YSON.parse<{ content?: YSON.Text }>(snapshot);
  return root.content ? YSON.textToString(root.content) : '';
}
