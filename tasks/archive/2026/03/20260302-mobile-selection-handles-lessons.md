# Mobile Selection Handles — Lessons

## Architecture

- The canvas autofill handle (8x8px) was too small for touch and would
  conflict with the bottom-right selection handle. Threading a
  `hideAutofillHandle` option through Options → Spreadsheet → Worksheet
  cleanly suppresses it on mobile without affecting desktop.
- `toRefFromMouse` was private in Worksheet. Added a public
  `cellRefFromPoint(clientX, clientY)` wrapper that converts client
  coordinates by subtracting the viewport offset, then delegates.
- `selectStart` and `selectEnd` were only available on the Sheet model
  class. Exposed them on the Spreadsheet facade with render + notify.

## React Hooks

- `useCallback` must be called before any early return in a component.
  The initial plan placed it after `if (!range) return null`, which
  violates the rules of hooks. Moved hooks above the early return.

## Touch Interaction

- Two handles are better UX than one: top-left handle shrinks from the
  start, bottom-right extends from the end. The top-left handle works
  by swapping the anchor to the current bottom-right corner, then
  extending selection to the touch point.
- 44px touch target (via padding + negative margin) around a 20px visual
  circle provides comfortable touch interaction per Apple HIG guidelines.
- `touchAction: "none"` on handles prevents browser scroll interference.
- `passive: false` on document-level touchmove listener allows
  `preventDefault()` to stop scrolling during handle drag.
