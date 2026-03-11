# Hide Formula Bar on Mobile Viewports

## Tasks

- [x] Add `hideFormulaBar` option to `Options` interface in `spreadsheet.ts`
- [x] Pass `hideFormulaBar` to Worksheet constructor
- [x] Conditionally skip FormulaBar DOM append in Worksheet
- [x] GridContainer uses `100%` height when formula bar is hidden
- [x] Frontend passes `hideFormulaBar: isMobileRef.current`
- [x] Verify `pnpm verify:fast` passes (911 tests, lint clean)
- [x] Deploy and confirm on mobile
