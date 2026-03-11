# Lessons — Clickable Hidden Indicator

## Priority ordering for mouse interactions
The worksheet mouse handling follows a strict priority chain:
Freeze handle → Hidden indicator → Resize edge → Filter button → ...

Hidden indicator takes priority over resize because resize is meaningless at
a hidden boundary (the hidden row/column has 0 size). This must be consistent
across `handleMouseDown`, `handleMouseMove`, and `handleDblClickAt`.

## Reuse existing helpers
`findAdjacentHiddenRows`/`findAdjacentHiddenColumns` already existed for the
context menu "Show rows/columns" feature. The new `detectHiddenIndicator`
method reuses them to find all contiguous hidden indices at a boundary.

## Hover state management pattern
Follow the existing `setFilterButtonHoverCol` pattern: compare old vs new,
skip if unchanged, trigger `render()` on change. This avoids unnecessary
re-renders while keeping the UI responsive.
