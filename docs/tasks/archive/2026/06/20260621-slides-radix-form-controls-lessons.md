# Lessons — Slides Radix form-control migration

## Test-location grep scope

- **Mistake**: when scoping the test impact before the migration, I
  grepped only `packages/frontend/src` and missed
  `text-fitting-section.test.tsx` under the `tests/` directory. I also
  searched the literal "Do not autofit" while the test uses the regex
  `/do not autofit/i` → a case mismatch meant it went undetected.
- **Rule**: when scoping a component change, (1) grep both `src` and
  `tests`, (2) search aria-labels case-insensitively, (3) search by both
  the component name (`SizePositionSection`) and the file path.

## Test-assertion changes when migrating to Radix

- native `<select>`/`<input>` → Radix changes the DOM structure:
  - radio: `<input type=radio>.checked` → the `aria-checked` attribute on
    the `role=radio` button.
  - select: the `<select>` tag disappears → button trigger. Tests relying
    on `select`/`option` selectors break.
- `fireEvent.click(getByLabelText(...))` and aria-label lookups behave
  identically across both → interaction tests mostly pass unchanged. Only
  **direct state assertions (.checked/.value)** need updating.
- This repo has no jest-dom configured → no `toBeChecked()` /
  `toHaveAttribute()`. Assert directly via `.getAttribute('aria-checked')`.

## Radix Select value type

- Radix Select's value/onValueChange are **string-only**. When binding
  numeric state (durationMs), send it down with `String(value)` and
  convert back with `Number(value)`.

## Consolidating repeated selects

- The 5 identically-structured selects were consolidated into a generic
  `MotionSelect<T extends string>` local helper to remove duplication.
  The existing accessibility names are preserved by deriving
  label→aria-label (`Animation ${label.toLowerCase()}`).
