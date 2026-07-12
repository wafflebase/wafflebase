# Data validation: Number & Text kinds

Extends data validation with `number` and `text` criteria, reusing the
`operator` + `values` model built for `date` (design:
`docs/design/sheets/data-validation.md`). No formula-engine change; warning
marker + reject commit path are reused.

## Operators (Google Sheets parity)

- **number**: `numberValid` (0, "is a number") · `numberEquals` / `numberNotEquals`
  / `numberGreater` / `numberGreaterEq` / `numberLess` / `numberLessEq` (1) ·
  `numberBetween` / `numberNotBetween` (2).
- **text**: `textContains` / `textNotContains` / `textEquals` (1) ·
  `textIsEmail` / `textIsUrl` (0).

## Plan (TDD)

- [x] `types.ts`: add `'number' | 'text'` to `DataValidationKind`; extend
      `DataValidationOperator` union with the operators above.
- [x] `data-validation.ts`:
  - [x] `validationOperandCount(op)` covering all kinds; `dateValidationOperandCount`
        delegates.
  - [x] `isValidNumberValue` / `isValidTextValue`; dispatch in `isValidValueForRule`.
  - [x] `describeNumberRule` / `describeTextRule` for reject/hover messages.
  - [x] Normalize number/text in `normalizeDataValidationRule` (fixed-length
        operand slots, degrade-to-valid when incomplete, never drop, onInvalid
        defaults warning) — mirrors date.
  - [x] Add `'number','text'` to the `Kinds` set.
- [x] Model unit tests (14 new): operand counts, number comparisons (reversed
      between swap, non-number → invalid, degrade), text ops (contains
      case-insensitive, email/url, is-exactly), normalization, dispatch.
- [x] Render (`gridcanvas.ts`): generalized the date warning-marker branch to
      date/number/text via `isValidValueForRule`.
- [x] Commit path (`worksheet.ts`): shared `validationRuleDetail` dispatcher
      backs reject toast + hover tooltip for date/number/text.
- [x] Panel (`data-validation-panel.tsx`): Number / Text criteria; the date-only
      editor refactored into one shared `COMPARISON_KINDS`-driven section.
- [x] `pnpm verify:fast` green (EXIT 0); design doc Phase 5 section.

## Out of scope

- Custom-formula criteria; relative operands; range-source lists.
- Checkbox eager-init / custom-value UI (separate).

## Review

(filled after implementation)
