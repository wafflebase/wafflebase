# Mobile Edit Panel Multiline & Formula Support

Expand the mobile edit panel to support multiline text.

## Context

Current `MobileEditPanel` uses a single-line `<input>` element. Long text
gets truncated and formulas are hard to author without visual feedback.
The panel should grow to accommodate content and provide basic formula
helpers.

## Tasks

- [x] Replace `<input>` with `<textarea>` (auto-growing)
  - Auto-resize height based on scrollHeight (min 1 line, max 4 lines)
  - Keep single-line appearance for short values
- [~] Show formula indicator when value starts with `=` — skipped (YAGNI)
- [x] Enter inserts newline, confirm via check button only
- [x] Preserve keyboard offset behavior with variable-height panel
- [x] Run `pnpm verify:fast` and confirm pass
