# Lessons — Slides: undoing Add slide leaves the editor on the removed slide

Issue: #883

## What the bug really was

Not an undo bug. `store.undo()` restored the `slides` array correctly;
the editor's `currentId` was simply never revalidated against it. Every
*call site* that removed a slide (the thumbnail panel's `Delete slide`)
moved the cursor by hand, so the invariant "the current id exists" was
maintained by convention instead of by the editor. Undo — and a peer's
delete — are removal paths with no local call site to fix up, so they
fell straight through.

## Where the fix belongs

The editor already resolves `currentId` → slide in two places
(`render()` and `repaintOverlay()`), both of which held a `store.read()`
snapshot and both of which silently bailed when the lookup failed. That
made the resolution point the natural home for the invariant: heal once,
and every removal path inherits it.

## Traps found on the way

- **Do not read the store to heal.** `render()` has an idle
  short-circuit that must not call `store.read()` on a clean frame
  (`render-idle-short-circuit.test.ts` pins it; a Yorkie-backed board
  frame costs ~65 ms otherwise). The heal has to sit *inside* the
  existing read, after the dirty gate.
- **Re-entrancy.** `exitEditMode` / `exitImageCrop` / `selection.clear()`
  all re-enter `repaintOverlay()`, which resolves the current slide
  again. Assign `currentId` / `currentIndex` *before* tearing that state
  down, so the nested resolve sees a valid id and stops instead of
  recursing.
- **Discard, don't commit.** A crop session or text edit anchored to the
  removed slide has nowhere to write, so it is cancelled
  (`exitImageCrop(false)` / `exitEditMode('cancel')`), unlike
  `setCurrentSlide` which commits both.
