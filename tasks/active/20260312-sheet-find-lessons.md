# Sheet Find (Ctrl+F) — Lessons

## Patterns Used

1. **Overlay parameter threading**: Search highlights follow the same pattern as
   other overlay features (formula ranges, copy range, etc.) — state stored on
   Worksheet, passed through to Overlay.render() as additional parameters.

2. **Store.getGrid() for bulk cell access**: Rather than iterating the entire
   dimension space, `getGrid(fullRange)` returns only populated cells, making
   search efficient on sparse sheets.

3. **Row-major sort**: Results sorted by (row, col) for predictable navigation
   order matching Google Sheets behavior.

## Gotchas

- The Overlay.render() method has many parameters. Added search params at the
  end to minimize disruption to existing callers.
- TypeScript unused import/variable errors caught by `tsc --noEmit` in verify:fast.
  Always run typecheck before considering a change complete.
