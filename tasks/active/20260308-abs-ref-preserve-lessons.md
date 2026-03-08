# Lessons: Preserve absolute reference markers ($)

## Key decisions

- `AbsRef` extends `Ref` with two booleans rather than a separate type to enable
  easy pass-through to existing `moveRef`/`shiftRef` functions.
- `parseAbsRef` detects `$` positions before stripping them (reuses `parseRef` internally).
- `redirectFormula` keeps using `toSref(parseRef(...))` for map lookup keys (without `$`)
  but preserves original abs flags when writing output.

## Gotcha

- `moveFormula` test: `remapIndex` can shift refs *between* src and dst, so a ref at
  row 2 when moving row 1→3 shifts backward to row 1. Must trace through `remapIndex`
  carefully when writing test expectations.
