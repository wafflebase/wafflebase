# Sheets Date Data Validation — Todo

Design: `docs/design/sheets/data-validation.md` → "Phase 4 (date)" section.

Full Google Sheets date operators + calendar picker. Fixed-date operands only
(relative "today" deferred). Reuses the Phase-1/2 checkbox/list Store,
structural-edit, and panel spine unchanged.

## Scope (confirmed)

- Full GS date operators: `dateValid` / `dateEquals` / `dateBefore` /
  `dateOnOrBefore` / `dateAfter` / `dateOnOrAfter` / `dateBetween` /
  `dateNotBetween`.
- Calendar picker popover (double-click), modeled on `listPopover`.
- Fixed ISO operands only; relative operands deferred.

## Plan (detailed plan pending `writing-plans`)

- [x] Model: replace `dateMin`/`dateMax` with generic `operator` + `values`
      (`types.ts`, `data-validation.ts`); `DataValidationOperator` union.
- [x] Normalization: date default `dateValid`, trim `values` to operand count,
      normalize operands to ISO; never drop a date rule for missing operands;
      `onInvalid` default `warning`. (Stop-at-first-gap preserves operand order.)
- [x] Validation: pure `isValidDateValue(rule, value)` reusing `inferInput`;
      empty allowed; ISO lexicographic compare; formulas pass reject.
- [x] Render: warning marker for invalid date (reuse list path); no glyph.
- [x] Interaction: generalize `commitCellValue`/tooltip to dispatch by kind
      via `isValidValueForRule`; date reject/warning.
- [x] Interaction: calendar popover on double-click (DOM overlay, viewport-flip,
      operator-bounded disabled days, `setData` on pick, `Esc` close, read-only
      skip, native `Date`).
- [x] Panel: add Date criteria + operator select + 0/1/2 date inputs +
      reject/warning radio; in-progress date rule persists as `dateValid`.
- [x] Tests: `isValidDateValue` per operator (boundaries, invalid, empty);
      normalization + operand-position; clone deep-copy. (Store round-trip and
      keymap reject-nav already covered by the shipped list/checkbox suites.)
- [x] `pnpm verify:fast` green. Interactive `pnpm dev` smoke deferred to a
      manual pass (matches checkbox/list phases).

## Review

Shipped over 7 SDD tasks on branch `sheets-date-validation` (worktree
`~/Development/wafflebase/wafflebase-dateval` after a concurrent session took the
primary checkout for the xlsx feature — see lessons + `project_concurrent_session_stash`).

Commits:
- `86eb7ca` design + plan + todo
- `3b517eb` model: `operator`/`values`, `DataValidationOperator`, clone/normalize
- `3c9a0dd` fix: preserve operand positions (stop-at-gap) + strip operand time
- `9795aa7` `isValidDateValue` + `isValidValueForRule`
- `b2983c5` gridcanvas warning marker (no glyph, render-time)
- `dec6e0d` kind-agnostic commit reject + hover tooltip
- `1ffc7f4` double-click calendar picker (+ stale docblock fix)
- `d8038e5` panel Date criteria

Each task passed an independent per-task review (Task 5 on opus); Task 1's review
caught and fixed the operand-misposition bug. Whole-branch integration verified
directly (stores/structural-edits preserve the new fields via clone+normalize; no
dangling `dateMin`/`dateMax`; read-only inert; operand semantics consistent across
normalize/validate/render/picker). Full `verify:fast` green at HEAD.

Non-blocking follow-ups: relative operands, reject-on-paste/API, keyboard
day-nav + i18n in the picker, visible operand `<Label>`, automated coverage for
the Canvas/DOM/panel paths, and the interactive app smoke (deferred to manual).
