# Data Validation Phase 2 (list) — Lessons

## What went smoothly

- **Reusing the Phase-1 spine.** The `DataValidationRule` type already carried
  `list` / `showArrow` / `onInvalid`, and the Store / structural-edit / Yorkie
  serialization paths are kind-agnostic — so `kind: 'list'` needed *zero* Store
  or schema changes. Confirming this up front (via an Explore map of the whole
  checkbox implementation) saved a lot of guesswork.
- **Shared geometry helper pattern.** `computeListArrowBox` (module-level, like
  `computeCheckboxBox`) is used by both the renderer and the hit-test, with the
  same unzoomed-space round-trip in `getListArrowHitRect`. Keeping one geometry
  source is what prevents the click target from drifting from the drawn glyph at
  zoom ≠ 1.

## Gotchas / decisions

- **List cells keep their text; checkbox cells don't.** The checkbox Pass-3
  branch `continue`s (replacing the value with a glyph). For list I deliberately
  *don't* continue — the cell renders its text via `renderCellContent`, then a
  follow-on overlay draws the arrow (background-masked so text doesn't bleed
  under it) plus the warning marker.
- **Reject restore is free.** On a rejected commit, skipping `setData` and
  letting the caller `render()` is enough: `FormulaBar.render()` re-reads
  `toInputString(activeCell)`, so the editors self-restore to the committed
  value. No manual editor reset needed.
- **Warning state is render-time only.** Membership is checked in the render
  pass (`isValidListValue`) and never persisted — same discipline as checkbox
  checked-state. A red top-right triangle marks warning-mode violations.
- **Notification channel.** Reject needed a way to reach the frontend toast;
  added a single `worksheet.setOnValidationError` → `spreadsheet.onValidationError`
  passthrough, mirroring the existing `onSelectionChange` shape rather than
  inventing an event bus.

## Multi-worktree trap (recurring)

- The `:5173` / `:3000` dev servers were served by a **different worktree**
  (`wafflesheets`), not this one. Backend CORS is pinned to `:5173`, so a second
  frontend can't auth against the shared backend, and restarting it would
  disrupt the other session. Net: live browser smoke can't be done from here
  without a dedicated stack — verified statically (typecheck + unit + build)
  instead and flagged the live smoke for the user. (See memory
  `project_multi_worktree_dev_server`.)

## Follow-ups

- Phase 3: date picker (calendar popover on double-click, `dateMin`/`dateMax`).
- Range-source lists, colored chips, full `Data → Data validation` side panel.
- Warning marker vs. comment marker collision at the top-right corner (rare).
