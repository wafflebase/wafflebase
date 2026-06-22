# Slides Tables — todo

Design doc: [`docs/design/slides/slides-tables.md`](../../design/slides/slides-tables.md)

Bring structured table editing to `@wafflebase/slides` for PowerPoint
and Google Slides parity. Replaces the current PPTX "flatten table"
import path (`packages/slides/src/import/pptx/table.ts`) which loses
merges, per-side borders, and structural fidelity. Benchmark deck:
the Yorkie chasm deck (tables on slides 24–27, 33–35).

## Status (2026-06-23)

P1–P4 are done. P5's granular Yorkie ops AND the two-user integration
test are done; table-cell presence is still deferred (see note below).
P6 (PDF export) is unblocked and transitively covered; only the visual
diff remains.

Discovered while picking up P5/P6 (2026-06-20):

- **Presence is a bigger feature than it looks.** As of 2026-06-20 the
  slides editor rendered NO peer-presence overlays — `getPeers()` existed
  but nothing in `view/` consumed it, and there was no `textCursor`
  presence field (the design doc's "extend existing textCursor" premise
  did not hold). **Update (2026-06-23):** PR #390 landed the missing
  peer-presence rendering layer (`packages/slides/src/view/editor/peers.ts`,
  `overlay.ts` rings, frontend `peer-view.ts`), so the blocker is lifted.
  The table-cell fields `selectedTableCells` / `textCursorCell` /
  `resizingTableEdge` are still net-new work, but they now extend the
  existing peer layer rather than waiting on it. Tracked here + in
  slides-collaboration.md.
- **P6 PDF export was blocked; now UNBLOCKED (2026-06-21).**
  `packages/slides/src/export/pdf.ts` did not exist — slides PDF export
  was itself an unstarted "Phase 5b" item. It now ships as a P0 raster
  exporter (PR #395,
  [`20260621-slides-pdf-export-todo.md`](./20260621-slides-pdf-export-todo.md)).
  Because that exporter rasterises each slide through the shared
  `drawSlide()` pipeline, tables already render in the PDF for free; the
  remaining P6 work below is **verification only** (a visual fixture
  diff), not new painter code.
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
- [x] Import fixture test using the Yorkie chasm deck slides 24–27, 33–35

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
- [ ] Presence: `selectedTableCells` (IN PROGRESS, branch
      `slides-table-cell-presence`) — static cell-range presence, the
      table analogue of the already-wired `selectedElementIds`. Pipeline:
      `SlidesPresence.selectedTableCells` → broadcast on
      `editor.onCellSelectionChange` → `mapPresenceToPeerView` →
      `computePeerOverlays` (new `cellRangeRectsOf` projector + `cellRects`
      output) → `renderPeerOverlays` peer-tinted cell fills. Geometry
      shared with the local path via a new `projectCellRangeRects` helper
      in `table-renderer.ts`.
  - [ ] `resizingTableEdge` — DEFERRED with the live-frame broadcast.
        It is a *live drag preview*; the element-level `activeFrames`
        live broadcast it pairs with is itself deferred (P2 of
        `archive/2026/06/20260621-slides-live-presence-todo.md`, blocked
        on the "no single gesture-end chokepoint to clear" problem). Build
        table edge-resize presence together with that, not standalone.
  - [ ] `textCursorCell` — DEFERRED. The design doc frames it as an
        extension of `textCursor`, but slides renders NO peer text carets
        today (only docs does); the live-presence todo lists peer text
        carets as an explicit separate PR. Needs that substrate first.
- [x] Two-user integration test — landed as
      `frontend/tests/app/slides/yorkie-slides-table-concurrent.integration.ts`
      (concurrent disjoint-cell edits, concurrent row insert,
      concurrent col insert, concurrent merge + disjoint-cell edit).
      4/4 green against a live Yorkie server.

## P6 — PDF export

Unblocked by the P0 slides PDF exporter (PR #395). The exporter
rasterises via the shared `drawSlide()` pipeline, so table cells already
render in the PDF without a dedicated painter — only verification remains.

- [x] Table case in `packages/slides/src/export/pdf.ts` — covered
      transitively: `drawTable` runs inside `drawSlide`, no table-specific
      export code needed.
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
