import type { Cell } from '@wafflebase/sheets';
import type { NoteDocument } from '../../yorkie/note-content';
import type { DocsDocument, SlidesDocument } from '../../yorkie/yorkie.types';
import type { BoardRoot } from './board';

/**
 * One template's content, in whatever shape its document type stores.
 *
 * These are the *snapshot* types the v1 content endpoints already accept, not
 * a seed-only format: `writeDocsRoot` / `writeSlidesRoot` / `writeNoteRoot`
 * take them verbatim. A seed that typechecks here is a payload the product's
 * own write path accepts, which is the point — a private format would let the
 * catalogue drift away from what the editors can actually open.
 */
export type SeedContent =
  | { kind: 'doc'; document: DocsDocument }
  | { kind: 'slides'; document: SlidesDocument }
  | { kind: 'note'; document: NoteDocument }
  | { kind: 'board'; root: BoardRoot }
  | {
      kind: 'sheet';
      /** Name for the single tab. */
      tabName: string;
      /** A1-keyed cells, written through `updateWorksheetCell`. */
      cells: Record<string, Cell>;
      /**
       * Rows frozen at the top — a header row, for every sheet here.
       *
       * Column widths are deliberately absent: `colWidths` is keyed by axis
       * **id** (see docs/design/sheets/axis-id-selection.md), not by column
       * index, so setting one means materializing `colOrder` first. Not worth
       * it for a seed; the grid's default width is fine.
       */
      frozenRows?: number;
    };

/** The `Document.type` a seed's content implies. */
export type SeedDocumentType = SeedContent['kind'];

/**
 * One catalogue entry: the listing metadata plus the content to put behind
 * it.
 *
 * `slug` is the seed's identity and never changes — it is how a re-run finds
 * the document it created last time instead of publishing a second copy of
 * the same template. It is not shown anywhere.
 */
export interface TemplateSeed {
  slug: string;
  title: string;
  description: string;
  /** Must be one of `TEMPLATE_CATEGORIES`; asserted by the catalogue test. */
  category: string;
  tags: string[];
  content: SeedContent;
}
