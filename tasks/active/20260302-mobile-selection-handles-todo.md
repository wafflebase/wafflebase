# Mobile Cell Selection Handles

Add draggable selection handles so mobile users can extend or shrink cell
ranges by dragging corner handles.

## Context

Desktop users extend selection by Shift+Click or drag. Mobile users have
no equivalent — they can only tap individual cells. Range selection is a
core spreadsheet interaction needed for formulas, formatting, and delete.

## Tasks

- [ ] Render selection handle overlays at corners of the active selection
  - Two handles: top-left and bottom-right of selection range
  - Visual: small circle or square, high-contrast, touch-friendly size (~28px)
- [ ] Detect drag on handle elements (touch events on handle overlay)
- [ ] During drag, update selection range in real time
  - Convert touch position to cell reference
  - Call spreadsheet API to update selection range
- [ ] Snap handle to cell boundaries during drag
- [ ] Handle edge cases: single-cell selection, frozen panes, off-screen drag
- [ ] Add visual regression baseline for selection handles
- [ ] Run `pnpm verify:fast` and confirm pass
