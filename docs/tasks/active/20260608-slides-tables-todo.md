# Slides Tables — todo

Design doc: [`docs/design/slides/slides-tables.md`](../../design/slides/slides-tables.md)

Bring structured table editing to `@wafflebase/slides` for PowerPoint
and Google Slides parity. Replaces the current PPTX "flatten table"
import path (`packages/slides/src/import/pptx/table.ts`) which loses
merges, per-side borders, and structural fidelity. Benchmark deck:
the Yorkie 캐즘 deck (tables on slides 24–27, 33–35).

## Status (2026-06-20)

P1–P4 are done. P5's granular Yorkie ops AND the two-user integration
test are done; presence is deferred (see note below). P6 (PDF export)
is blocked — slides has no PDF export module yet at all.

Discovered while picking up P5/P6 (2026-06-20):

- **Presence is a bigger feature than it looks.** The slides editor
  renders NO peer-presence overlays today — `YorkieSlidesStore.getPeers()`
  exists but nothing in `view/` consumes it, and there is no existing
  `textCursor` presence field (the design doc's "extend existing
  textCursor" premise does not hold). Adding `selectedTableCells` /
  `textCursorCell` / `resizingTableEdge` is net-new peer-overlay
  rendering for slides, not a field add. Deferred until slides grows a
  peer-presence rendering layer (tracked in slides-collaboration.md).
- **P6 PDF export is blocked.** `packages/slides/src/export/pdf.ts`
  does not exist — slides PDF export is itself an unstarted "Phase 5b"
  item (see the comment in `frontend/src/app/slides/slides-view.tsx`).
  The table PDF case can only land once that module exists.
- **Cell body is LWW JSON, not a Tree.** Despite the design doc saying
  "per-cell `body` Tree", `withTableCellBody` stores `cell.body.blocks`
  as a plain JSON value (last-writer-wins per cell). Same-cell
  concurrent edits resolve LWW; different-cell edits both survive. The
  integration test covers the different-cell / structural cases.

What landed (in commit order):

- `Slides: table frame sync + merge auto-grow + autofit (CR#4-7,14)`
- `Slides tables: hover I-beam, EPS drop, docs cleanups (CR#8-13,15)`
- `Slides tables: structured PPTX import (P2)`
- `Slides tables: cell text edit on dblclick (P3 first slice)`
- `Slides tables: Tab/Shift+Tab cell navigation`
- `Slides tables: insertTableRow + Tab-appends-row UX`
- `Slides tables: cell-range selection (click / shift / drag + Esc)`
- `Slides tables: Backspace clears cell-range contents`
- `Slides tables: insertTableColumn + deleteTableRow + deleteTableColumn`
- `Slides tables: mergeTableCells + unmergeTableCells store ops`
- `Slides tables: right-click context menu for cell-range ops`
- `Slides tables: cell fill + vAlign via context menu`
- `Slides tables: insert-table picker in the toolbar`
- `Slides tables: drag-resize column / row borders`
- `Slides tables: cell border presets (All / Outer / Clear)`
- `Slides tables: distribute columns / rows + delete table`
- `Slides tables: ←/→ at cell text boundary crosses to adjacent cell`
- `Slides tables: default cell borders on insert + cellSelection API`
- `Slides tables: TableControls toolbar (fill / vAlign / borders)`
- `Fix Yorkie store: scale table widths/heights on resize-frame`
- `Use forceRender ghost channel for table outer-frame resize`

## P0 — Design alignment

- [x] Review design doc with @hackerwins (model shape, Yorkie schema,
      non-goals around nested tables / linked sheets / `tableStyleId`)
- [x] Confirm `TextBody`-per-cell (vs `Block[]`) is the right level of
      reuse with the docs team
- [x] Lock the phase order (P1 → P2 → P3 → P4 → P5 → P6)

## P1 — Model + read-only render

- [x] Add `TableElement`, `TableRow`, `TableCell`, `CellStyle`,
      `CellBorder` to `packages/slides/src/model/element.ts`
- [x] Extend the `Element` union; update every switch in
      `view/canvas/element-renderer.ts`, `view/editor/selection.ts`,
      `model/clone.ts`, `model/group.ts`, `model/frame.ts`,
      `view/canvas/thumbnail.ts`
- [x] `view/canvas/table-renderer.ts` — layout + paint (fills,
      content via `layoutTextBody`, borders with OOXML collapse rules)
- [x] Snapshot tests covering simple 2×2, merged spans, mixed
      borders, vertical-align variants, content auto-grow

## P2 — PPTX import (structured)

- [x] Rewrite `packages/slides/src/import/pptx/table.ts`: `parseTable`
      returns `TableElement`
- [x] Replace `tableMergesIgnored` / `tableBordersApproximated` with
      `tablesImported` / `tableCellsImported`
- [x] Cover the PPTX mappings in the design doc's mapping table
- [x] Import fixture test using the Yorkie 캐즘 deck slides 24–27, 33–35

## P3 — Cell editing (text)

- [x] Cell-range selection state in `view/editor/selection.ts`
- [x] Cell-range overlay in the DOM overlay layer
- [x] Text-edit entry on dblclick (via `text-bridge.ts`, cell inner
      rect = bridge mount target)
- [x] Tab / Shift+Tab cell navigation; Tab from last cell appends a row
- [x] Arrow-at-boundary cell crossing (←/→)
- [x] Contextual toolbar: Table mode (TableControls component)
- [x] Cell-style toolbar: fill, vertical-align, border preset
      dropdown (All / Outer / Clear)
- [x] Cell padding control — uniform-padding dropdown in
      `TableControls` (presets 0/2/5/10 px + Custom), patches every
      target cell's `style.padding` via the existing
      `updateTableCellStyle` path. Model/renderer/store already
      supported `padding`; this was a UI-only gap. Behavioral test:
      `tests/app/slides/toolbar/table-controls.test.ts`.
- [ ] Per-side border picker (current is preset-only; per-side comes
      with the Format options panel work — deferred there, not built
      standalone)

## P4 — Structural edits

- [x] `insertTableRow` / `deleteTableRow` /
      `insertTableColumn` / `deleteTableColumn` on `MemSlidesStore`
- [x] `mergeTableCells` / `unmergeTableCells`
- [x] Border-drag column / row resize (cursor `col-resize` /
      `row-resize`, commit on `mouseup`)
- [x] Outer-frame proportional resize for `columnWidths` and row
      heights; commits via `updateElementFrame`
- [x] Outer-frame resize ghost — translucent table preview via the
      `forceRender(slide, doc, [ghost])` channel
- [x] Context menu items (insert / delete row & column, merge,
      unmerge, distribute, delete table)

## P5 — Yorkie + collaboration

- [x] `YorkieSlidesStore` table schema: `columnWidths` Array, `rows`
      Array, per-cell `body` Tree, per-cell `style` Object
- [x] All P3/P4 mutations emitted as the schema's intended granular
      ops (insertTableRow, deleteTableRow, insertTableColumn,
      deleteTableColumn, mergeTableCells, unmergeTableCells,
      updateTableColumnWidths, updateTableRowHeights,
      updateTableCellStyle, withTableCellBody)
- [ ] Presence: `selectedTableCells`, `textCursorCell`,
      `resizingTableEdge` (deferred — needs a slides peer-presence
      rendering layer that does not exist yet; see Status note)
- [x] Two-user integration test — landed as
      `frontend/tests/app/slides/yorkie-slides-table-concurrent.integration.ts`
      (concurrent disjoint-cell edits, concurrent row insert,
      concurrent col insert, concurrent merge + disjoint-cell edit).
      4/4 green against a live Yorkie server.

## P6 — PDF export

- [ ] Table case in `packages/slides/src/export/pdf.ts`
- [ ] Visual PDF diff against a fixture deck under
      `pnpm verify:browser:docker`

## Verification gates

- Each P-phase ends with `pnpm verify:fast` green and a fresh
  `superpowers:requesting-code-review` (or `/code-review`) pass over
  the branch diff. ✅ P1–P4 cleared.
- P5 additionally requires `pnpm verify:integration` (Postgres +
  Yorkie). Deferred until presence + two-user test land.
- P6 requires `pnpm verify:browser:docker`. Not started.

## Deferred / explicit non-goals (carried from design doc)

- Cell-level images, charts, nested tables
- Cell-level Yorkie undo/redo (use `store.batch` snapshots)
- Linked-spreadsheet tables (separate "Embedded sheets" v2 item)
- `tableStyleId` theme binding (resolved at import, then dropped)
- Same-cell character-level concurrent merge (LWW at cell Tree)
- PPTX export of tables (tracked under v2 PPTX export item in
  `slides.md`; the structured model added here makes it mechanical)

## Review section

_To be filled in once P5 presence + integration test and P6 land.
Lessons captured in `20260608-slides-tables-lessons.md` as the work
progresses._
