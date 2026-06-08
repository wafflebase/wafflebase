# Slides Tables — todo

Design doc: [`docs/design/slides/slides-tables.md`](../../design/slides/slides-tables.md)

Bring structured table editing to `@wafflebase/slides` for PowerPoint
and Google Slides parity. Replaces the current PPTX "flatten table"
import path (`packages/slides/src/import/pptx/table.ts`) which loses
merges, per-side borders, and structural fidelity. Benchmark deck:
the Yorkie 캐즘 deck (tables on slides 24–27, 33–35).

## P0 — Design alignment

- [ ] Review design doc with @hackerwins (model shape, Yorkie schema,
      non-goals around nested tables / linked sheets / `tableStyleId`)
- [ ] Confirm `TextBody`-per-cell (vs `Block[]`) is the right level of
      reuse with the docs team — `autofit` / `verticalAnchor` at the
      cell level is the key inheritance
- [ ] Lock the phase order; in particular whether P2 (PPTX import)
      should precede P3 (editing) so the benchmark deck immediately
      benefits, or vice versa to land editing without a behavior
      change for imports first

## P1 — Model + read-only render

- [ ] Add `TableElement`, `TableRow`, `TableCell`, `CellStyle` to
      `packages/slides/src/model/element.ts`
- [ ] Extend the `Element` union; update every switch in
      `view/canvas/element-renderer.ts`, `view/editor/selection.ts`,
      `model/clone.ts`, `model/group.ts`, `model/frame.ts` (hit-test
      and bbox), `view/canvas/thumbnail.ts`
- [ ] `view/canvas/table-renderer.ts` — layout + paint (fills,
      content via existing `layoutTextBody`, borders with OOXML
      collapse rules)
- [ ] Snapshot tests covering: simple 2×2, merged spans, mixed
      borders, vertical-align variants, content auto-grow

## P2 — PPTX import (structured)

- [ ] Rewrite `packages/slides/src/import/pptx/table.ts`:
      `parseTable` returns `TableElement` (not `SlideElement[]`)
- [ ] Replace `ctx.report.tableMergesIgnored` /
      `tableBordersApproximated` with `tablesImported` /
      `tableCellsImported`; update the import toast in
      `frontend/src/app/slides/...`
- [ ] Cover the PPTX mappings in the design doc's mapping table
      (gridSpan/rowSpan, hMerge/vMerge, lnL/R/T/B, tcPr marL/R/T/B,
      bodyPr anchor, fill resolution)
- [ ] Import fixture test using the Yorkie 캐즘 deck slides 24–27,
      33–35 (extract the seven `<a:tbl>` payloads as fixtures so the
      test isn't bound to the source file)

## P3 — Cell editing (text)

- [ ] Cell-range selection state in `view/editor/selection.ts`
- [ ] Cell-range overlay in the DOM overlay layer
- [ ] Text-edit entry on dblclick / Enter / printable-char via the
      existing `text-bridge.ts` (cell inner rect = bridge mount target)
- [ ] Tab / Shift+Tab cell navigation; Tab from last cell appends a row
- [ ] Arrow-at-boundary cell crossing
- [ ] Contextual toolbar: Table mode (vs Text / Shape / Image)
- [ ] Cell-style toolbar: fill, border (per side picker), padding,
      vertical-align

## P4 — Structural edits

- [ ] `insertTableRow` / `deleteTableRow` /
      `insertTableColumn` / `deleteTableColumn` on `MemSlidesStore`
- [ ] `mergeTableCells` / `unmergeTableCells`
- [ ] Border-drag column / row resize (cursor `col-resize` /
      `row-resize`, commit on `mouseup`)
- [ ] Outer-frame proportional resize for `columnWidths` and row
      heights; auto-grow floor on row heights
- [ ] Context menu items (insert / delete row & column, merge,
      unmerge, delete table) per `docs/design/context-menu.md`

## P5 — Yorkie + collaboration

- [ ] `YorkieSlidesStore` table schema: `columnWidths` Array, `rows`
      Array, per-cell `body` Tree, per-cell `style` Object
- [ ] All P3/P4 mutations emitted as the schema's intended granular
      ops (no whole-table replacement)
- [ ] Presence: `selectedTableCells`, `textCursorCell`,
      `resizingTableEdge`
- [ ] `two-user-slides-table-yorkie.ts` integration test (concurrent
      cell edits, concurrent row insert, concurrent col insert,
      concurrent merge + cell edit)

## P6 — PDF export

- [ ] Table case in `packages/slides/src/export/pdf.ts`
- [ ] Visual PDF diff against a fixture deck under
      `pnpm verify:browser:docker`

## Verification gates

- Each P-phase ends with `pnpm verify:fast` green and a fresh
  `superpowers:requesting-code-review` (or `/code-review`) pass over
  the branch diff
- P5 additionally requires `pnpm verify:integration` (Postgres +
  Yorkie)
- P6 requires `pnpm verify:browser:docker`

## Deferred / explicit non-goals (carried from design doc)

- Cell-level images, charts, nested tables
- Cell-level Yorkie undo/redo (use `store.batch` snapshots)
- Linked-spreadsheet tables (separate "Embedded sheets" v2 item)
- `tableStyleId` theme binding (resolved at import, then dropped)
- Same-cell character-level concurrent merge (LWW at cell Tree)
- PPTX export of tables (tracked under v2 PPTX export item in
  `slides.md`; the structured model added here makes it mechanical)

## Review section

_To be filled in once P1–P6 are complete; lessons captured in
`20260608-slides-tables-lessons.md`._
