# Mobile Edit Panel Multiline & Formula Support

Expand the mobile edit panel to support multiline text and improve
formula editing experience.

## Context

Current `MobileEditPanel` uses a single-line `<input>` element. Long text
gets truncated and formulas are hard to author without visual feedback.
The panel should grow to accommodate content and provide basic formula
helpers.

## Tasks

- [ ] Replace `<input>` with `<textarea>` (or auto-growing input)
  - Auto-resize height based on content (min 1 line, max ~4 lines)
  - Keep single-line appearance for short values
- [ ] Show formula indicator when value starts with `=`
  - Visual cue (e.g., `fx` icon or colored border)
- [ ] Support Enter for newline in multiline mode, use a confirm button to commit
  - Or: Enter commits, Shift+Enter for newline (configurable)
- [ ] Preserve keyboard offset behavior with variable-height panel
- [ ] Update visual regression baselines
- [ ] Run `pnpm verify:fast` and confirm pass
