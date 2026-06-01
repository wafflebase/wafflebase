# Lessons — sheets comment popover viewport fit

## Reuse docs' pattern, but cell-aware

`DocsCommentPopover.tsx` already solves the "popover would clip off-screen"
problem with a `useEffect` that measures the rendered popover, then clamps
horizontally and flips vertically. Lifting that pattern verbatim into sheets
was tempting, but the docs popover **does not** care about hiding the source
marker — the marker is tiny and the popover happily covers it. Sheets cares:
the active cell is a real workspace artifact the user expects to keep
referencing while reading / writing a comment. So the algorithm grew an
extra layer:

1. Side preference (`right → left`) so the popover *side-steps* the cell.
2. Only when neither side fits (cell wider than half the panel) do we
   stack the popover above / below the cell.

Carrying that constraint inside the same `useLayoutEffect` was cleaner than
adding a separate visibility / clamp pass.

## `useLayoutEffect`, not `useEffect`

Docs uses `useEffect`, accepts a one-frame "popover at `-9999`" then jump.
On sheets the popover wrapper is `position: absolute` inside the grid
panel, so an unmeasured paint at `(0, 0)` shows the popover briefly in the
top-left corner — far enough from the anchor cell to be visible. Switching
to `useLayoutEffect` runs the measurement *before* the browser paints, and
combined with `visibility: hidden` until `commentPopoverPos` is set the
first paint is clean. Trade-off: `useLayoutEffect` blocks paint, but
measuring a 320 px popover once is sub-millisecond.

## Coordinate origins line up by accident-on-purpose

`Spreadsheet.getGridViewportRect()` returns coords relative to the sheet's
internal `container` element. The popover wrapper is rendered inside
`<div className="relative flex-1 w-full">` two `h-full w-full` wrappers
above the sheet container — neither carries padding or margin, so the
popover's absolute origin and the sheet's `(0, 0)` line up exactly. No
manual offset adjustment was needed. This is the same invariant
`paintFormatSourceIndicator` (10 lines above the popover code) silently
depends on. Keep it intact if you ever refactor the sheet view wrappers.

## Deps that catch what matters

The placement effect deps are
`[commentPopoverOpen, activeCellForComment, activeCellThreads.length, sheetRenderVersion]`:

- `commentPopoverOpen` — open / close transitions.
- `activeCellForComment` — moving the active cell (Cmd+Alt+M on a new
  cell) re-anchors the popover.
- `activeCellThreads.length` — adding / removing a thread changes
  popover height (top-align-vs-flip-up can flip).
- `sheetRenderVersion` — structural mutations (row/col insert/delete,
  chart layer changes) shift the cell.

Edits to existing comment bodies (textarea grows) are **not** caught.
That's an accepted limitation — in practice the popover stays at its
initial position and the height grows downward; if the bottom overflow
becomes a regression, a `ResizeObserver` on the wrapper is the targeted
fix (no need to widen the deps array).

## What was non-obvious

`useEffect(() => setCommentPopoverPos(null), [commentPopoverOpen])` is
needed even though the wrapper unmounts on close. Without it, re-opening
on a different cell would paint a frame at the *previous* cell's
coordinates before `useLayoutEffect` re-measures — because React reuses
the wrapper DOM node across opens. Resetting the position to `null` forces
`visibility: hidden` for that intermediate frame.
