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
