---
title: slides-tables
target-version: 0.5.0
---

# Slides Tables

## Summary

Add structured table editing to `@wafflebase/slides` to match PowerPoint
and Google Slides parity. A table is a new `Element` kind that owns its
own grid (rows × columns), per-cell text bodies, per-cell styling
(background, borders, padding, vertical alignment), and merged regions.

This replaces the current PPTX import path
(`packages/slides/src/import/pptx/table.ts`) which flattens `<a:tbl>`
into independent text + transparent-rect elements and reports
`tableMergesIgnored` / `tableBordersApproximated`. Real-world decks
contain tables on most non-cover slides (e.g. the Yorkie 캐즘 deck has
tables on slides 24–27 and 33–35), so flattening loses fidelity on
import, makes alignment impossible to maintain when slides are re-edited,
and blocks an eventual PPTX export.

### Goals

- New `TableElement` in the slides model — rows × cols grid, per-cell
  `TextBody`, per-cell style (fill, four-sided border, padding,
  vertical alignment), and `gridSpan` / `rowSpan` merge semantics.
- Cell text reuses the existing docs rich-text engine through the same
  `TextBody` / text-renderer / text-bridge surface already used by
  `TextElement` and shape inline text. No new text editor.
- Yorkie schema is granular enough that two users editing different
  cells don't collide and structural ops (insert/delete row or column)
  compose with cell text edits.
- PPTX import preserves the table as a `TableElement` instead of
  flattening; PPTX export emits a real `<a:tbl>` so decks round-trip.
- Editor affordances at parity with Google Slides' minimum:
  insert/delete row & column, merge/unmerge cells, drag column/row
  borders to resize, Tab / Shift+Tab cell navigation, cell-range
  selection + bulk delete, per-cell fill/border/alignment toolbar.

### Non-Goals

- **Cell-level images, charts, or nested tables.** Cells hold rich text
  only. Docs allows nested tables; slides v1 doesn't — the visual
  payoff in slide context is small and the editor complexity (cell
  resize cascading through nested rows) is large.
- **Cell-level Yorkie undo/redo.** Slides uses the existing
  snapshot-based undo path (`store.batch`); table ops batch the same
  way as any other element edit.
- **Linked-spreadsheet tables.** Tables are static OOXML-style grids,
  not embedded `@wafflebase/sheets` ranges. The latter is tracked under
  the existing "Embedded sheets" v2 item in `slides.md`.
- **Per-cell theming bound to `tableStyleId`.** PPTX `<a:tableStyleId>`
  references a master style in `ppt/tableStyles.xml` describing banded
  rows / header fills / etc. v1 imports the resolved per-cell style
  (fill, border, font) and drops the style ID. A future theme-aware
  table style system can re-introduce the binding.
- **Cell-internal paragraph types beyond what `TextBody` already
  carries.** Lists and inline formatting are in scope (they come for
  free); headings inside cells are not.
- **Same-cell character-level concurrent merge.** Two users typing in
  the same cell at the same time fall back to LWW at the cell's text
  Tree, matching the docs-tables decision in
  [docs-tables.md](../docs/docs-tables.md) §Non-Goals.
- **Cell text shrink-autofit.** Cell bodies always lay out at full size
  and rows grow to fit (`max(declared row.height, contentHeight)`).
  Imported PPTX `<a:normAutofit/>` on a table cell is dropped on import
  — PowerPoint shrinks cell text in this mode but the auto-grow policy
  matches Google Slides and ~90% of real decks. Re-introducing per-cell
  shrink is a v2 affordance gated on a fixed-row-height toggle.

## Proposal Details

### Data model

Add a fifth element kind to the union in
`packages/slides/src/model/element.ts`:

```ts
export type TableElement = ElementBase & {
  type: 'table';
  data: {
    /**
     * Column widths in slide-logical pixels. The sum equals the
     * rendered table width — `frame.w` is kept in sync but
     * `columnWidths` is authoritative. Mirrors OOXML
     * `<a:tblGrid><a:gridCol w="..."/>`.
     */
    columnWidths: number[];
    /**
     * Row heights in slide-logical pixels. Each row's height is the
     * max of (this value, computed content height across its cells).
     * Mirrors OOXML `<a:tr h="..."/>` — PPTX stores the *minimum*
     * row height; content grows it.
     */
    rows: TableRow[];
    /** Optional table-wide style id; preserved for PPTX round-trip. */
    tableStyleId?: string;
  };
};

export type TableRow = {
  height: number;
  cells: TableCell[];
};

export type TableCell = {
  /** Rich text body. Reuses the engine already used by TextElement. */
  body: TextBody;
  style: CellStyle;
  /**
   * 1 = unmerged. >1 = anchor cell of a horizontal merge spanning
   * `gridSpan` columns. 0 = covered cell (rendered as no-op).
   */
  gridSpan?: number;
  /**
   * 1 = unmerged. >1 = anchor cell of a vertical merge spanning
   * `rowSpan` rows. 0 = covered cell.
   */
  rowSpan?: number;
};

export type CellStyle = {
  fill?: ThemeColor | string;
  border?: {
    top?: Stroke;
    right?: Stroke;
    bottom?: Stroke;
    left?: Stroke;
  };
  /** Pixels; defaults: 8 LR, 4 TB (matches PPTX EMU defaults). */
  padding?: { top: number; right: number; bottom: number; left: number };
  verticalAlign?: VerticalAnchorMode; // 'top' (default) | 'middle' | 'bottom'
};

export type Element =
  | TextElement
  | ImageElement
  | ShapeElement
  | ConnectorElement
  | GroupElement
  | TableElement;          // new
```

Key choices:

- **`TextBody` per cell, not `Block[]`.** A cell behaves like a tiny
  text box — `autofit` and `verticalAnchor` apply at the cell level.
  Reuses every rendering and editing path that already exists for
  `TextElement.data` and `ShapeElement.data.text`.
- **`gridSpan` / `rowSpan` use OOXML semantics.** `>1` on an anchor;
  `0` on covered cells. Matches PPTX and avoids a second representation
  for the same idea. (Docs tables use the same encoding, see
  [docs-tables.md §Cell Merge Rules](../docs/docs-tables.md#cell-merge-rules).)
- **Frame stays the table's outer rect** so existing selection,
  drag-move, rotate, alignment, distribute, snap, group-membership,
  and PPTX `<p:xfrm>` round-trip work unchanged. `frame.w` and
  `frame.h` are recomputed from `columnWidths` and row heights on
  every structural mutation; rotation works but resize on the outer
  frame proportionally scales widths/heights (Google Slides behavior).
- **No `placeholderRef`.** PPTX layouts can include a `<p:ph type="tbl">`
  placeholder, but Google Slides doesn't expose table placeholders.
  Imported placeholder tables become free elements; `placeholderRef`
  on `TableElement` is intentionally unused.

### Store interface

Extend `SlidesStore` in `packages/slides/src/store/store.ts` with
table-aware mutations. Each is a single `store.batch` entry, matching
the convention every other structural slide op already uses.

```ts
interface SlidesStore {
  // ...existing...

  /** Create a fresh r × c table; cells start with one empty paragraph. */
  addTable(
    slideId: string,
    init: {
      frame: Frame;
      rows: number;
      cols: number;
      columnWidths?: number[];   // defaults: equal split of frame.w
      rowHeights?: number[];     // defaults: equal split of frame.h
    },
  ): string;

  insertTableRow(slideId: string, elementId: string, atIndex: number): void;
  deleteTableRow(slideId: string, elementId: string, rowIndex: number): void;
  insertTableColumn(slideId: string, elementId: string, atIndex: number): void;
  deleteTableColumn(slideId: string, elementId: string, colIndex: number): void;

  /** Merge a rectangular cell range into the top-left anchor. */
  mergeTableCells(
    slideId: string, elementId: string,
    range: { r0: number; c0: number; r1: number; c1: number },
  ): void;
  /** Inverse of merge; covered cells regain `gridSpan/rowSpan = 1`. */
  unmergeTableCells(
    slideId: string, elementId: string,
    anchor: { row: number; col: number },
  ): void;

  /** Resize column widths or row heights atomically. */
  updateTableColumnWidths(
    slideId: string, elementId: string, widths: number[],
  ): void;
  updateTableRowHeights(
    slideId: string, elementId: string, heights: number[],
  ): void;

  /** Patch a cell's style (fill, border, padding, vAlign) — LWW per key. */
  updateTableCellStyle(
    slideId: string, elementId: string,
    row: number, col: number, patch: Partial<CellStyle>,
  ): void;

  /** Hand the caller the live cell text tree (mirrors withTextElement). */
  withTableCellBody(
    slideId: string, elementId: string,
    row: number, col: number,
    fn: (tree: docs.Tree) => void,
  ): void;
}
```

`MemSlidesStore` implements these against the in-memory representation;
`YorkieSlidesStore` adapts them to the schema below.

### Yorkie schema

Reuses the patterns already established by docs tables (granular Tree
edits) and the slides TextElement (per-element Yorkie Tree for body).

```
slide.elements: Yorkie.Array<Element>
└── element (type='table')
    ├── frame: { x, y, w, h, rotation }                          # LWW
    ├── columnWidths: Yorkie.Array<number>                       # per-col LWW
    ├── tableStyleId?: string                                    # LWW
    └── rows: Yorkie.Array<Row>
        └── row
            ├── height: number                                   # LWW
            └── cells: Yorkie.Array<Cell>
                └── cell
                    ├── style: Yorkie.Object<CellStyle>          # per-attr LWW
                    ├── gridSpan?: number                        # LWW
                    ├── rowSpan?: number                         # LWW
                    └── body: Yorkie.Tree                        # docs Tree
```

Concurrent-edit behavior (same shape as docs tables — see
[docs-tables.md §Concurrent Editing Behavior](../docs/docs-tables.md#concurrent-editing-behavior)):

| Scenario | Outcome |
|---|---|
| Different cells edited simultaneously | Independent Tree edits — **merged** |
| Same cell text edited simultaneously | LWW at the cell's Tree root |
| Cell style + different cell text | Different nodes — **both preserved** |
| Row inserted + cell edited | Different ops on `rows` Array vs cell Tree — **both preserved** |
| Column inserted on different rows simultaneously | Operates on each row's `cells` Array; Yorkie Array semantics give a deterministic resolved order |
| Column inserted + cell merged | Both apply; covered-cell markers stay aligned because `gridSpan = 0` is per-cell, not positional |
| Concurrent row delete + cell edit in the same row | Row delete wins (the cell node no longer exists); the edit is lost. Same trade-off docs tables already make. |

#### Structural-op ordering

Row insert/delete iterates `rows` directly via `Yorkie.Array` ops.
Column insert/delete iterates every row in a single `doc.update()`
callback so partial column states never observe (matches
docs-tables.md §Yorkie Tree Path Mapping). Merges write `gridSpan`
/ `rowSpan` on the anchor and `gridSpan: 0` / `rowSpan: 0` on covered
cells, all in one batch.

Resize (drag a column or row border) commits one `updateTableColumnWidths`
/ `updateTableRowHeights` on `mouseup`. Intermediate drag frames travel
via presence (see below), never CRDT.

### Presence

Extend `SlidesPresence` with table-aware fields so peer cursors render
correctly inside cells and concurrent drag-resize doesn't fight:

```ts
type SlidesPresence = {
  // ...existing...

  /** Selected cell range when a TableElement is selected. */
  selectedTableCells?: {
    elementId: string;
    r0: number; c0: number;
    r1: number; c1: number;
  };

  /**
   * Peer text cursor inside a specific cell (extension of textCursor;
   * the existing `textCursor.elementId` carries the table id and
   * `cellRow / cellCol` disambiguate which cell).
   */
  textCursorCell?: { row: number; col: number };

  /**
   * Optimistic column / row border drag preview, broadcast at pointer
   * frequency while resizing; cleared on commit.
   */
  resizingTableEdge?: {
    elementId: string;
    axis: 'col' | 'row';
    index: number;       // border between index and index+1
    deltaPx: number;
  };
};
```

### Rendering pipeline

Add `view/canvas/table-renderer.ts`. The pipeline:

1. **Compute layout.** For each cell, run `layoutTextBody(cell.body,
   cellInnerWidth)` (same call the text-renderer already makes for
   `TextElement.data` and `ShapeElement.data.text`). Stack lines
   vertically; record `contentHeight`. Row height = max(declared
   height, max contentHeight across the row's non-covered cells).
2. **Paint cell fills.** Iterate non-covered cells, fill rect using
   `style.fill` resolved through `render-context.ts`.
3. **Paint cell content.** Translate into the cell's inner rect
   (padding + vertical-anchor offset) and call the existing
   `text-renderer` block painter.
4. **Paint cell borders.** Compute per-edge stroke. Adjacent cells share
   an edge — use OOXML/CSS `border-collapse` semantics (thicker, then
   darker wins). Merged spans skip interior edges.
5. **Paint selection / cell-range overlay** in the DOM overlay layer,
   not on canvas — same separation slides already uses for the
   selection box.

Hit testing (in `view/editor/`) converts pointer-in-slide-coords to
`(row, col)` by binary-searching `columnXOffsets` / `rowYOffsets`,
accounting for `frame.rotation`. The covered-cell test inspects
`gridSpan === 0 || rowSpan === 0` and snaps to the anchor.

#### Reuse of docs layout

The renderer never reaches into docs internals beyond the same
`layoutTextBody` already exported and consumed by
`view/canvas/text-renderer.ts`. No new docs surface is required.

### Editor interactions

| Action | Input | Behavior |
|---|---|---|
| Select cell | click inside a cell | enter cell-selection (`selectedTableCells = {r,c,r,c}`); outer selection handles disappear, cell-range overlay appears |
| Extend cell range | shift-click or drag inside table | grow / shrink rectangular range; covered cells included by anchor |
| Enter text edit | double-click in cell, Enter when range = 1 cell, or printable-char type | mount the existing text-bridge contenteditable overlay anchored to the cell's inner rect; `withTableCellBody` provides the live Tree |
| Tab / Shift+Tab | inside text edit | commit cell, advance to next/prev cell; Tab from last cell appends a new row |
| Arrow at cell boundary | inside text edit | exit cell into adjacent cell (same rule as docs tables) |
| Exit table | Esc, click outside | exit cell-range mode → element selection → idle |
| Insert / delete row | context menu, toolbar, or Cmd+Opt+Enter | `insertTableRow` / `deleteTableRow` |
| Insert / delete column | context menu or toolbar | `insertTableColumn` / `deleteTableColumn` |
| Merge / unmerge | toolbar; range must be rectangular | `mergeTableCells` / `unmergeTableCells` |
| Resize column / row | hover the border between cells (cursor becomes `col-resize` / `row-resize`), drag | live preview via presence; commit on `mouseup` |
| Resize outer frame | drag the element's outer handles | proportionally scale `columnWidths` and row heights; rotation handle works as on any element |
| Cell fill / border / padding / vAlign | contextual toolbar when a cell range is selected | `updateTableCellStyle` |

The contextual toolbar gains a **Table** mode (replaces the Text /
Shape / Image mode while a `TableElement` is selected): inserts table,
add/delete row, add/delete column, merge / unmerge, cell fill, cell
border, vertical alignment. While a cell text is being edited, the
toolbar switches to the existing text-formatting mode (font, size,
bold, color, alignment) — the table mode is one tier outside.

#### Right-click context menu

In line with `docs/design/context-menu.md`:

- On a table (element selection): Cut, Copy, Paste, Insert row above /
  below, Insert column left / right, Merge cells (when range), Unmerge
  cells (when anchor), Delete row, Delete column, Delete table.
- Inside a cell during text edit: the cell mode picks up the standard
  text-edit context menu (Cut/Copy/Paste/Link/Format/...).

#### Keyboard

| Shortcut | Action |
|---|---|
| `Tab` / `Shift+Tab` in cell | next / prev cell; appends row at last cell |
| `Esc` | exit cell text edit → cell selection → element selection |
| `Cmd/Ctrl+A` in cell | select all cell text |
| `Cmd/Ctrl+A` with cell range | extend to full table |
| `Delete` / `Backspace` with cell range | clear cell text in range (keep structure) |
| `Delete` / `Backspace` with element selection | delete the table |
| Arrow keys with cell range (no text edit) | move active cell within the table |

### PPTX import

Rewrite `packages/slides/src/import/pptx/table.ts` to return a
`TableElement` instead of a list of text + rect elements. Mapping:

| OOXML | Slides table |
|---|---|
| `<p:graphicFrame>/<p:xfrm>` | `frame` (x, y, w, h, rotation) via `parseXfrm` (unchanged) |
| `<a:tbl>/<a:tblPr>/<a:tableStyleId>` | `data.tableStyleId` (preserved verbatim) |
| `<a:tblGrid>/<a:gridCol w>` (EMU) | `data.columnWidths[]` (px via `ctx.scale.sx`) |
| `<a:tr h>` (EMU) | `row.height` (px via `ctx.scale.sy`) |
| `<a:tc>` | `TableCell` |
| `<a:tc gridSpan>` / `<a:tc rowSpan>` | `gridSpan` / `rowSpan` on anchor |
| `<a:tc hMerge>` / `<a:tc vMerge>` | covered cells, `gridSpan: 0` / `rowSpan: 0` |
| `<a:tc>/<a:tcPr marL/R/T/B>` | `style.padding` (EMU → px) |
| `<a:tc>/<a:tcPr>/<a:fill>` | `style.fill` via `parseColorFromContainer` |
| `<a:tc>/<a:tcPr>/<a:lnL/R/T/B>` | `style.border.left/right/top/bottom` (each independent `Stroke`) |
| `<a:tc>/<a:tcPr anchor>` | `style.verticalAlign` (`t`/`ctr`/`b`) |
| `<a:tc>/<a:txBody>` | `body: TextBody` via existing `parseTextBody` |

`ctx.report.tableMergesIgnored` and `ctx.report.tableBordersApproximated`
counters are retired; replace with `ctx.report.tablesImported` (success
count) and `ctx.report.tableCellsImported`. The non-blocking import
toast text in `frontend/src/app/slides/...` updates correspondingly.

### PPTX export

Add `packages/slides/src/export/pptx/table.ts`, the inverse of import.
The slides export pipeline doesn't exist yet (see Non-Goals in
`slides.md` — PPTX export is v2). When that work lands, `TableElement`
emits `<p:graphicFrame>/<a:tbl>` directly; until then, in-app authored
tables export to PDF (which already paints from the canvas renderer,
so this works on day one) but do not round-trip back to PPTX.

PDF export reuses the same `layoutTextBody` calls as Canvas rendering;
the PDF writer in `packages/slides/src/export/pdf.ts` gains a table
case parallel to its existing text / shape / image cases.

### Migration

No on-disk migration is needed for existing slide docs — the new
`type: 'table'` is additive. The PPTX importer goes from "produces
text + rect elements" to "produces table elements", so re-importing
an existing benchmark deck will look different from the previous
import. This is intended; the previous output is a degraded
approximation. Old in-app decks created by the v1 PPTX importer keep
working (they contain only `text` / `shape` / `image` elements).

### Phasing

| Phase | Deliverable | Verification |
|---|---|---|
| P1. Model + read-only render | `TableElement` type, `MemSlidesStore` add/get, `table-renderer.ts`, fixture-based snapshot tests | `pnpm slides test` + visual fixture in standalone harness |
| P2. PPTX import (structured) | Rewrite `import/pptx/table.ts`, retire flatten path, update import report counters, fixture for the Yorkie 캐즘 deck | Snapshot diff vs prior flattened output; import-roundtrip unit tests |
| P3. Cell editing | Cell-range selection, text edit via existing text-bridge, Tab/Shift+Tab navigation, cell-style toolbar | Vitest interaction tests for selection + Tab; visual smoke |
| P4. Structural edits | Insert/delete row/col, merge/unmerge, drag-resize column/row borders, outer-frame proportional scale | Vitest tests; manual smoke |
| P5. Yorkie + collaboration | `YorkieSlidesStore` table ops, presence (`selectedTableCells`, `resizingTableEdge`), concurrent-edit integration test | Postgres+Yorkie integration test `two-user-slides-table-yorkie.ts` |
| P6. PDF export | `export/pdf.ts` table case; visual PDF diff against a fixture deck | `pnpm verify:browser:docker` extension |

Each phase ends with `pnpm verify:fast`; P5 additionally requires
`pnpm verify:integration`; P6 requires `pnpm verify:browser:docker`.

PPTX export remains tracked under the existing v2 backlog item in
`slides.md` ("PPTX export"). Adding it later is a single new module —
the structured model added here makes it mechanical.

### Risks and Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| Cell-range hit-test on rotated tables is a common bug surface | Selection feels broken | Reuse the rotated hit-test helpers in `model/frame.ts`; add a unit-test matrix mirroring the resize-on-rotated tests called out in `slides.md` Risks |
| Concurrent row insert + same-row cell text edit | Lost edit on row delete | Document the LWW boundary at the row node (same docs-tables compromise); raise a warning toast if a remote row-delete kills an in-progress local edit |
| Per-cell layout cost on big tables | Slow re-render during structural edits | Cache `LayoutTableCell.contentHeight` per cell-body; invalidate only when the cell's Tree or width changes (same dirty-block pattern docs already uses) |
| Border-collapse rules are subtly different in PowerPoint vs CSS | Visible regression on imported decks | Use the OOXML rule (thicker wins; tie → darker; tie → adjacent-cell's right/bottom over the next cell's left/top), not the CSS rule; encode in `table-renderer.ts` with a focused unit test |
| Cell text edit overlay placement drifts when rows auto-grow during typing | Cursor jumps mid-IME composition | Run the cell-content layout against the *committed* row height during composition; reflow on composition-end only (matches the docs IME path) |
| PPTX `tableStyleId` carries banded-row / header-shading rules we don't preserve | Imported tables look "flatter" than the source | Resolve and bake the per-cell fill at import time (since `ppt/tableStyles.xml` is available); drop the binding. PPTX export later emits a no-style table to preserve fidelity |
| Outer-frame resize that scales widths/heights conflicts with auto-grow | Resize feels rubber-bandy near the content-floor | Outer-frame resize only scales row *declared* height, never below `contentHeight`. Below-floor drags clamp visually but the declared height clamps to `contentHeight`, matching PowerPoint |
| Adding `TableElement` to `Element` union touches every element switch in slides | Many small edits; merge conflicts likely | Land P1 as a single PR that updates all switches at once (renderer, hit-test, clone, group operations, frame ops, PPTX import shape switch) |
