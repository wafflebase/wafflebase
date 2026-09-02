import { YSON } from '@yorkie-js/sdk';
import type { SpreadsheetDocument } from '@wafflebase/sheets';
import type { Element, SlidesDocument } from '@wafflebase/slides';
import { boardToSlidesDocument } from '@wafflebase/board';
import type { YorkieBoardRoot } from '@/types/board-document';
import { unwrapYsonScalars } from './unwrap-yson';

/**
 * A revision snapshot is YSON: JSON plus constructor-wrapped CRDT values
 * (`Int(320)`, `Long(…)`, `Text([...])`, `Tree({...})`). For sheets, slides
 * and board the root is otherwise plain JSON — the backend's `read*Root`
 * helpers exist to unwrap *live* Yorkie proxies and have no job here.
 *
 * Parsing alone is **not** the whole conversion, though: `YSON.parse` hands
 * every scalar literal back as a tagged object (`Int(320)` →
 * `{type:'Int',value:320}`), so each adapter runs the result through
 * {@link unwrapYsonScalars} before it reaches an engine that types those
 * fields `number`. See that module for what went wrong without it.
 *
 * `YSON.parse`'s preprocessor is regex-based and throws once a `Tree(...)`
 * nests past three brace levels, which every wafflebase docs document does
 * (`doc > block > inline > text` is depth 4). Docs snapshots are therefore
 * unparsable until that upstream limit is fixed; callers must handle the
 * throw.
 */
export function parseSheetSnapshot(snapshot: string): SpreadsheetDocument {
  return unwrapYsonScalars<SpreadsheetDocument>(YSON.parse(snapshot));
}

export function parseSlidesSnapshot(snapshot: string): SlidesDocument {
  return unwrapYsonScalars<SlidesDocument>(YSON.parse(snapshot));
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
  const root = unwrapYsonScalars<Partial<YorkieBoardRoot>>(YSON.parse(snapshot));
  return boardToSlidesDocument({
    // Mirrors `YorkieBoardStore.read()`'s defaults: a board that was never
    // edited has no `meta` at all (a viewer attaches with an empty initial
    // root — see `boardInitialRootForRole`).
    meta: {
      title: root.meta?.title ?? 'Untitled board',
      unit: root.meta?.unit,
      recentColors: root.meta?.recentColors,
    },
    // Unwrapped above, so these are already the plain `Element` objects the
    // model wants — every `frame` number a number, no proxy left to detach.
    elements: (root.elements ?? []) as unknown as Element[],
  });
}

/**
 * A note's whole content is one `Text` CRDT, which {@link unwrapYsonScalars}
 * passes through by reference — unwrapping it would destroy the very thing
 * `YSON.textToString` needs. The walk still runs, so any scalar a future note
 * root gains alongside `content` is normalised like every other type's.
 */
export function parseNoteSnapshot(snapshot: string): string {
  const root = unwrapYsonScalars<{ content?: YSON.Text }>(YSON.parse(snapshot));
  return root.content ? YSON.textToString(root.content) : '';
}
