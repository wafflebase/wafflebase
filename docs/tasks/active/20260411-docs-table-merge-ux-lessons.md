# Docs Table Merge UX — Lessons

Date: 2026-04-11
Todo: [20260411-docs-table-merge-ux-todo.md](20260411-docs-table-merge-ux-todo.md)

## Patterns to keep

- **A single source of truth for merged-cell line layout.** The renderer
  (`renderTableContent`), the cursor (`resolvePositionPixel`), click-to-offset
  (`resolveOffsetInCellAtXY`), cell-range highlight (`buildCellRangeRects`),
  and cell-internal selection rects (`buildRects`) all call
  `computeMergedCellLineLayouts`. When pagination math needs to change, we
  change it in one place and the five consumers stay consistent. The helper
  returns per-line `{ ownerRow, runLineY }` so every consumer can derive
  both "which page does this belong to" and "what Y does it render at"
  without duplicating the content-flow walk.
- **Per-page render args carry both `pageStartRow` and `renderStartRow`.**
  `renderStartRow` is swept back to the merged cell's top-left so the cell
  gets visited for borders/background, while `pageStartRow` is the real
  first row physically laid out on the current page. The cell renderer
  filters lines by `pageStartRow` (so content draws once) but sizes the
  border rect from `visibleStart = max(r, pageStartRow)` (so each page's
  slice looks like a complete 4-sided cell).

## Mistakes to avoid

- **`??` vs `||` for inline color strings.** Inline styles can store
  `color: ''` (empty string) — `??` treats `''` as a real value and hands
  it to `ctx.fillStyle`, which silently ignores invalid color strings and
  keeps whatever fillStyle was already there. If the last thing drawn was
  a selection highlight, table text renders in the selection color. Use
  `||` so an empty string falls through to `Theme.defaultColor`, matching
  what `renderRun` in `doc-canvas.ts` already does.
- **Center-of-line ownership picks the wrong row when `rowHeights > lineHeight`.**
  An early merged-cell pagination fix mapped each line to a row by checking
  which row range its center Y fell into. With rows taller than lines
  (e.g. 28-px rows × 20-px lines) two consecutive lines can share a row
  range and the third line overflows into the same range, so lines 2 and
  3 both got page 1 and line 3 straddled the break. Use a content-flow
  walk: advance to the next row when the current row can't fit the next
  line. That matches what users expect ("N lines in N rows → one per row")
  and stays correct for non-uniform row heights.
- **Cell-internal multi-line selection can't step by a single line height.**
  The old `midY += startPixel.height` loop in `buildRects` assumed lines
  flow on a single continuous Y axis within a cell. With per-row
  distribution (merged cells split across pages) each line has an
  independent rendered Y, so the middle-line strip ended up painting into
  the empty space below the cell's first row on page 1. Iterate cell
  lines from `startLineIdx` to `endLineIdx` and compute each line's Y via
  `computeMergedCellLineLayouts`.
- **Always run the per-page row filter in `resolveTableFromMouse`.** Mouse
  hit-testing for a multi-page table cannot use one `tablePageY` — the
  caller must walk each page's line band for the table and only resolve
  inside the band the mouse is actually over. Returning `pageFirstRow` /
  `pageLastRow` lets `detectTableBorder` skip row boundaries that belong
  to another page, which stops the resize cursor from flashing in the
  empty space below a merged cell's first row on page 1.
- **`@wafflebase/docs` is imported from `dist/`, not source.** The package's
  `exports` field in `packages/docs/package.json` points at
  `dist/wafflebase-document.es.js`. That means any change inside
  `packages/docs/src/` is invisible to `pnpm dev` until you run
  `pnpm --filter @wafflebase/docs build`. Adding a new method to `EditorAPI`
  and only running `pnpm --filter @wafflebase/docs test` will make tests
  pass but the dev frontend will still call the old dist, throwing
  `editor.getTableMergeContext is not a function` silently inside a React
  event handler — the menu opens but the new slot falls through to its
  default state. Any plan that touches `packages/docs` *and* expects the
  frontend to see it should include an explicit `pnpm --filter
  @wafflebase/docs build` step before manual smoke testing.
- **Expanded `TableCellRange.end` may land on a covered cell (`colSpan === 0`).**
  `expandCellRangeForMerges` grows the bounding rect to fully contain any
  merge, so the rect's bottom-right corner can be a covered position. When
  using the expanded range to pick a cursor target, read the cell at the
  *raw* hit-test result (e.g. `currentCA` from `resolveTableCellClick`),
  not at `tableCellRange.end`. Otherwise the cursor disappears into a
  non-rendered cell block. Only the stored selection value needs to be
  expanded; the visual cursor target stays on the user's actual drop point.
