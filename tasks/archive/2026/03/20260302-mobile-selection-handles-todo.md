# Mobile Cell Selection Handles

Add draggable selection handles so mobile users can extend or shrink cell
ranges by dragging corner handles.

## Context

Desktop users extend selection by Shift+Click or drag. Mobile users have
no equivalent — they can only tap individual cells. Range selection is a
core spreadsheet interaction needed for formulas, formatting, and delete.

## Tasks

- [x] Render selection handle overlays at corners of the active selection
  - Two handles: top-left and bottom-right of selection range
  - Visual: 20px circle with 44px touch target, bg-primary color
- [x] Detect drag on handle elements (touch events on handle overlay)
- [x] During drag, update selection range in real time
  - Convert touch position to cell reference via cellRefFromPoint
  - Call spreadsheet selectEnd/selectStart to update selection range
- [x] Snap handle to cell boundaries during drag
- [x] Handle edge cases: single-cell selection, frozen panes
- [x] Hide canvas autofill handle on mobile (replaced by React handles)
- [x] Run `pnpm verify:fast` and confirm pass
