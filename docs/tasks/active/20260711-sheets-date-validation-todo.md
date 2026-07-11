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

- [ ] Model: replace `dateMin`/`dateMax` with generic `operator` + `values`
      (`types.ts`, `data-validation.ts`); `DataValidationOperator` union.
- [ ] Normalization: date default `dateValid`, trim `values` to operand count,
      normalize operands to ISO; never drop a date rule for missing operands;
      `onInvalid` default `warning`.
- [ ] Validation: pure `isValidDateValue(rule, value)` reusing `inferInput`;
      empty allowed; ISO lexicographic compare; formulas pass reject.
- [ ] Render: warning marker for `warning`-mode invalid date (reuse list path);
      no persistent glyph.
- [ ] Interaction: generalize `commitCellValue` list branch to dispatch by kind;
      date reject/warning.
- [ ] Interaction: calendar popover on double-click (DOM overlay, viewport-flip,
      operator-bounded disabled days, `setData` on pick, `Esc` close, read-only
      skip, native `Date`).
- [ ] Panel: add Date criteria + operator select + 0/1/2 date inputs +
      reject/warning radio; in-progress date rule persists as `dateValid`.
- [ ] Tests: `isValidDateValue` per operator (boundaries, invalid, empty);
      normalization; Store round-trip; keymap reject-navigation.
- [ ] `pnpm verify:fast` green; manual smoke in `pnpm dev`.

## Review

(pending)
