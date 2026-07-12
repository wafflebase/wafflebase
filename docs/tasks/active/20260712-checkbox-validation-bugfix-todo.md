# Checkbox data-validation bug fixes

Follow-ups from the data-validation design doc (`docs/design/sheets/data-validation.md`,
Phase-1 "Not yet guarded" note). Two clear correctness bugs in the shipped
checkbox control, each self-contained.

## Bugs

1. **Formula cell is not read-only under a checkbox rule.**
   `Sheet.toggleCheckboxAt` (`sheet.ts:3834`) reads `cell?.v` and writes a
   literal `TRUE`/`FALSE` via `setData` without checking `cell.f`. Toggling a
   checkbox that sits over a formula cell **overwrites the formula**. Design
   intent: a formula-backed checkbox is read-only (the formula drives the
   state) — Google Sheets / Excel parity. Both the click path
   (`worksheet.ts:3405`) and the Space path (`worksheet.ts:4853`) route through
   `toggleCheckboxAt`, so one guard fixes both.

2. **`isCheckboxChecked` is case-sensitive.**
   `isCheckboxChecked` (`data-validation.ts:149`) compares `value === 'TRUE'`
   exactly, so a cell holding `"true"` renders **unchecked**. `setData`
   normalizes typed input to `"TRUE"`, but values arriving via xlsx import /
   REST API / external paste can be lowercase and bypass normalization. The
   formula engine (`formula.ts:1054`) and input parser (`input.ts:242`) already
   treat `TRUE`/`FALSE` case-insensitively; the render/toggle path should match.
   Fix scope: **fully-default boolean checkbox only** (neither custom value
   set) — a rule with *either* custom value (`checkedValue`/`uncheckedValue`)
   stays an exact string match (GS parity). See
   `docs/design/sheets/data-validation.md` for the authoritative contract.

## Plan (TDD)

- [x] Model test: `isCheckboxChecked` matches `"true"`/`"True"`/`"TRUE"` for a
      default rule; a custom-value rule stays exact-match.
- [x] Model fix: `isCheckboxChecked` case-insensitive for the fully-default
      boolean checkbox only; `toggleCheckboxValue` inherits the fix (delegates).
- [x] Sheet test: `toggleCheckboxAt` over a formula cell is a no-op — returns
      `false`, leaves `cell.f` intact, writes no `v`.
- [x] Sheet fix: guard `toggleCheckboxAt` on `cell?.f`.
- [x] `pnpm test` (sheets) green; `pnpm verify:fast` green (EXIT 0).
- [x] Update design doc Phase-1 "Not yet guarded" note (both now fixed).

## Review

High-effort workflow code review (`Workflow code-review`, 4 finders + verify)
surfaced two findings, both addressed:

- **[0] correctness (PLAUSIBLE)** — case-fold branch was gated only on
  `checkedValue === undefined`, so a rule with a custom `uncheckedValue` that
  upper-cases to `"TRUE"` inverted state. Fixed: case-folding now requires
  *both* custom values absent; added a regression test.
- **[1] cleanup (CONFIRMED)** — `value.toUpperCase()` allocated per repaint,
  against the file's no-alloc convention. Fixed: canonical `TRUE`/`FALSE`
  short-circuit before the `toUpperCase` fallback.

A refuted finding ("silently depends on `CHECKBOX_TRUE` being uppercase") was
dismissed by the verifier — `CHECKBOX_TRUE` is a module constant.

Both bugs are model/Sheet-level; the click and Space view paths route through
`toggleCheckboxAt` and the render path through `isCheckboxChecked`, so no
view-layer change was needed. View-layer smoke deferred (Phase-1 precedent).

## Out of scope (separate follow-ups)

- Space range-uniform "set all checked" (parity feature, not a bug).
- Merged-cell glyph/hit-test mismatch.
- Eager `FALSE` materialization for `COUNTIF`.
- Custom checkbox values UI.
