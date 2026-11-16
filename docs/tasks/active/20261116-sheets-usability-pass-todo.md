# Sheets usability pass

Source: Impeccable critique of the Sheets editor (2026-11-16, 22/40,
`.impeccable/critique/2026-11-16T01-06-18Z__packages-frontend-src-app-spreadsheet.md`).
Scope chosen by the user: every P1 + P2 finding, one PR. The missing menu
bar is a **deliberate** decision, so hidden features are exposed through the
toolbar and context menus instead of a menu bar.

Executed as four parallel workstreams with disjoint file ownership, merged
onto `sheets-usability-pass`.

## A. Input focus and keyboard parity (`/impeccable harden`)

- [x] Closing a dialog (e.g. Cmd+/ shortcut sheet) with Esc returns focus to
      the grid; the next grid click selects the clicked cell and typing goes
      there, not into the previously selected cell
- [x] Cmd+F while the find bar is already open refocuses and selects its input
- [x] Find counter reflects the highlighted match (no `0/0` with a visible hit)
- [x] Name box is an editable input: typing `C3` / `B2:D4` + Enter navigates /
      selects; Esc restores; never writes into the active cell
- [x] Tab…Tab…Enter returns to the column where the Tab run started (Google)
- [x] Cmd/Ctrl+D fills down, F2 enters edit mode, Shift+Space selects the row
      (Ctrl+Space the column); shortcut sheet lists them

## B. Number formats, CF and DV defaults (`/impeccable clarify` + `colorize`)

- [x] "Currency ($)" and "Locale currency" are distinct formats; only the
      applied one shows a check; the `$` toolbar button's label matches what
      it applies
- [x] Remove the inert "US date preview" row; add real items where the model
      supports them (accounting, date, time, date-time, scientific)
- [x] Conditional formatting default rule is readable in light and dark
      (Google default: `#B7E1CD` fill with dark text)
- [x] CF and DV panels open pre-filled from the current selection
- [x] Underline toolbar button (text wrap skipped: `CellStyle` and the
      renderer have no wrap support)

## C. Grid rendering, filter and chart parity (`/impeccable polish`)

- [x] Row/column headers highlight across the whole selected range, not only
      the active cell
- [x] Create filter from a single cell expands to the contiguous data region
      (rows and columns), as Google does
- [x] A new chart is placed beside its source range, not over it
- [x] A numeric first row/column is not treated as series headers

## D. Hidden features without a menu bar

- [x] Cell context menu: insert row above/below, insert column left/right,
      delete row/column
- [x] Freeze rows/columns reachable from the row/column header context menus
      (not only the drag handle)
- [x] Sheet tab "+" adds a sheet directly (Google); other sheet kinds stay
      reachable
- [x] Sheet tab context menu gains Duplicate if the store supports it

## Verification

- [x] Each workstream: unit tests for behavior changes, `pnpm verify:fast`
- [x] Merged branch: `pnpm verify:fast`, then manual smoke in `pnpm dev`
- [x] `/self-review` bounded loop
- [ ] Re-run `/impeccable critique` and record the new score (after merge)

## Review

Four worktree agents (A–D) ran in parallel; merged onto
`sheets-usability-pass`. Every commit passed `pnpm verify:fast`.

- A: name box `<input>` with ref/range navigation, Tab…Enter return column,
  Cmd/Ctrl+D/R fill (one undo step), F2, Shift/Ctrl+Space, Cmd+F refocus,
  find counter only for its own query, closing-layer click rescue (hit-tested,
  never the dismissing press). `Sheet2!A1` jumps deferred.
- B: scientific/accounting/financial/time/date-time formats; menu built from
  presets with one checked entry; currency pinned on apply; CF default
  `#B7E1CD` + dark text; CF/DV panels open on a draft for the selection
  (single cell included); underline button. Custom format dialog and duration
  deferred.
- C: every spanned header lit (softer butter wash, multi-range); single-cell
  filter expands to the current region; chart header detection, placement
  beside the data, `chart-1..5` palette, currency ticks, X-axis None option.
  A persisted "use row 1 as headers" toggle deferred.
- D: cell menu insert/delete row/column with counts, header-menu freeze /
  unfreeze, "+" adds a sheet, tab Duplicate / Move, labelled tablist.
- Coordinator: dark-mode ink picked by contrast on filled cells (shared with
  the cell editor), `upload-queue-lazy-deps` cold-import budget.
- Browser smoke (dark, 1120px): header range highlight, name box jump,
  Tab…Enter, click after dialog close, Cmd+D, CF draft + readable fill,
  context-menu insert/delete — all as expected.
- Self-review: 3 rounds (5 → 6 → 1 blocking), all fixed; see lessons.
