# Docs Table Merge UX — Lessons

Date: 2026-04-11
Todo: [20260411-docs-table-merge-ux-todo.md](20260411-docs-table-merge-ux-todo.md)

## Patterns to keep

(Filled in as the work progresses.)

## Mistakes to avoid

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
