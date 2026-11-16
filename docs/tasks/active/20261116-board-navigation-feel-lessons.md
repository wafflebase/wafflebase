# Board navigation feel — lessons

## Unit-tested key gates said nothing about listener order

Unit tests for `handleBoardToolKey` passed, and the docs already claimed
"Shift+1 works with a selection". In the browser, Shift+2 on a selected
sticky started a text edit seeded with `@`. Two separate causes:

1. **Order.** The slides editor's key rules are a bubble-phase `document`
   listener registered before the board's. Type-to-edit therefore saw the
   key first. Fix: the board handler moved to the capture phase.
2. **The editor ignores `defaultPrevented`.** Even once the board ran
   first and called `preventDefault()`, type-to-edit still ran. Fix:
   `stopPropagation()` on every key the board consumes.

**Rule:** when two document-level keydown handlers share a key, test them
together in a browser (or with a real dispatch through both listeners),
not one handler against a mock. Check both the phase and whether the
other handler honours `defaultPrevented`.

## Inline cursors lose to the editor's hover writer

`canvas.style.cursor = "grab"` for Space-pan was overwritten by the
editor's hover logic on the next `pointermove`. A container attribute with
an `!important` rule is the robust way for a host to override a cursor
that the engine owns.

## Self-review log

- Round 1: correctness, blast-radius and test-adequacy blocked. The hand /
  read-only pan claim is a capture listener on `container`, so it also
  swallowed the minimap's drag-to-navigate (a real viewer regression).
  Fixed by scoping it to the scene surface. Shift+2's framing had no test,
  so it was extracted as `selectionFitViewport` and given one.
- Round 2: correctness and test-adequacy blocked. A hand drag starting on
  a selection handle resized the element, and the drag-claim rule had no
  test. The design-fit reviewer (superpowers) also found that a
  double-click under the hand still entered text edit. Fixed: arming the
  hand clears the selection, the claim covers the whole overlay, and a
  capture `dblclick` guard runs while panning is armed. The rule is now
  `claimsPanDrag` with tests. Also from the design reviewer: Esc disarms
  the hand, the grab cursor is scoped to canvas + overlay, and the viewer
  H/V special case is gone. Deferred: moving `fitSelection` into the zoom
  binding, and zoom keys during an in-progress insert drag (pre-existing
  for tool keys).
- Round 3 (the bound): only test-adequacy blocked, on two missing tests.
  One proves that non-zoom Mod chords (Mod+A/Z/S/C//) pass through the
  capture handler untouched; the other is a render test for the toolbar
  Hand toggle and its subscription. Both were added after the round. No
  fourth round was run, per the loop bound.
