# Sheets usability pass

Source: Impeccable critique of the Sheets editor (2026-11-16, 22/40,
`.impeccable/critique/2026-11-16T01-06-18Z__packages-frontend-src-app-spreadsheet.md`).
Scope chosen by the user: every P1 + P2 finding, one PR. The missing menu
bar is a **deliberate** decision, so hidden features are exposed through the
toolbar and context menus instead of a menu bar.

Executed as four parallel workstreams with disjoint file ownership, merged
onto `sheets-usability-pass`.

## A. Input focus and keyboard parity (`/impeccable harden`)

- [ ] Closing a dialog (e.g. Cmd+/ shortcut sheet) with Esc returns focus to
      the grid; the next grid click selects the clicked cell and typing goes
      there, not into the previously selected cell
- [ ] Cmd+F while the find bar is already open refocuses and selects its input
- [ ] Find counter reflects the highlighted match (no `0/0` with a visible hit)
- [ ] Name box is an editable input: typing `C3` / `B2:D4` + Enter navigates /
      selects; Esc restores; never writes into the active cell
- [ ] Tab…Tab…Enter returns to the column where the Tab run started (Google)
- [ ] Cmd/Ctrl+D fills down, F2 enters edit mode, Shift+Space selects the row
      (Ctrl+Space the column); shortcut sheet lists them

## B. Number formats, CF and DV defaults (`/impeccable clarify` + `colorize`)

- [ ] "Currency ($)" and "Locale currency" are distinct formats; only the
      applied one shows a check; the `$` toolbar button's label matches what
      it applies
- [ ] Remove the inert "US date preview" row; add real items where the model
      supports them (accounting, date, time, date-time, scientific)
- [ ] Conditional formatting default rule is readable in light and dark
      (Google default: `#B7E1CD` fill with dark text)
- [ ] CF and DV panels open pre-filled from the current selection
- [ ] Underline and text-wrap toolbar buttons if the model already supports them

## C. Grid rendering, filter and chart parity (`/impeccable polish`)

- [ ] Row/column headers highlight across the whole selected range, not only
      the active cell
- [ ] Create filter from a single cell expands to the contiguous data region
      (rows and columns), as Google does
- [ ] A new chart is placed beside its source range, not over it
- [ ] A numeric first row/column is not treated as series headers

## D. Hidden features without a menu bar

- [ ] Cell context menu: insert row above/below, insert column left/right,
      delete row/column
- [ ] Freeze rows/columns reachable from the row/column header context menus
      (not only the drag handle)
- [ ] Sheet tab "+" adds a sheet directly (Google); other sheet kinds stay
      reachable
- [ ] Sheet tab context menu gains Duplicate if the store supports it

## Verification

- [ ] Each workstream: unit tests for behavior changes, `pnpm verify:fast`
- [ ] Merged branch: `pnpm verify:fast`, then manual smoke in `pnpm dev`
- [ ] `/self-review` bounded loop
- [ ] Re-run `/impeccable critique` and record the new score

## Review

(filled in after implementation)
