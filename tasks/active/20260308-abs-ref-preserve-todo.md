# Preserve absolute reference markers ($) during formula rewriting

GitHub Issue: #24

## Tasks

- [x] Add `AbsRef` type and `parseAbsRef`/`toAbsSref` helpers in `coordinates.ts`
- [x] Update `moveFormula` to preserve abs flags
- [x] Update `shiftFormula` to preserve abs flags (shift value, keep markers)
- [x] Update `relocateFormula` to skip delta for absolute dimensions
- [x] Update `redirectFormula` to preserve abs flags through lookup
- [x] Add tests for `parseAbsRef`/`toAbsSref` round-trip
- [x] Add tests for all four formula rewrite functions with absolute refs
- [x] `pnpm verify:fast` passes

## Review

All four formula rewrite functions now preserve `$` markers:
- **relocateFormula**: absolute dimensions skip the delta (key semantic difference)
- **shiftFormula/moveFormula/redirectFormula**: apply transforms normally but carry abs flags through
