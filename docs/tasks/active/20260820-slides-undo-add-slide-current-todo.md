# Slides: undoing Add slide leaves the editor on the removed slide

Issue: #883

## Problem

`Add slide` makes the new slide current. Undo restores the document's
`slides` array, but nothing moves the editor's `currentId` off the slide
that was just removed — so the editor keeps naming an id that is no
longer in the deck and paints nothing:

```
start              count=2  index=1     elements=4
after Add slide    count=3  index=2     elements=0
after undo         count=2  index=null  <- current id not in the deck
```

`SlidesEditorImpl.render()` / `repaintOverlay()` already look the current
slide up by id and bail out when it is missing, which is why the canvas
goes blank instead of crashing. The same dangling-id state happens when a
peer deletes the slide the local user is on.

## Approach

Heal the cursor where the editor already resolves it, so every removal
path (undo, redo, a peer's delete, a local `removeSlides`) is covered by
one rule rather than each call site remembering to move the cursor:

- Track `currentIndex` — the index `currentId` was last resolved at.
- Add `resolveCurrentSlide(doc)`: returns the current slide, and when the
  id is missing from a non-empty deck moves the cursor to the slide just
  before the vanished index (for an undone insertion that is the slide
  the user came from), notifying `onCurrentSlideChange` subscribers.
- Call it from `render()` and `repaintOverlay()` in place of their inline
  `doc.slides.find(...)`. Both already hold a `store.read()` snapshot, so
  this adds no read — importantly it stays *after* `render()`'s idle
  short-circuit (see `render-idle-short-circuit.test.ts`).
- Discard interaction state anchored to the removed slide (crop session,
  in-place text edit, cell selection, element selection) — it can no
  longer commit anywhere.

## Tasks

- [x] Read the editor's current-slide resolution paths
- [x] Add `currentIndex` + `resolveCurrentSlide()` and wire both call sites
- [x] Unit test: undo of `Add slide` lands on the previously-current slide
- [x] Unit test: remote-style removal of the current slide heals too
- [x] Unit test: the heal cancels a text edit / crop session anchored to
      the removed slide (exercises the re-entrant `render()` path)
- [x] Confirm the existing `render-idle-short-circuit` suite stays green
      (the heal must add no `store.read()` on a clean frame)

## Acceptance criteria (from the issue)

- After undoing `Add slide`, the editor is on a slide that exists — the
  one that was current before the insertion.
- Any removal of the current slide moves the cursor somewhere valid,
  whether it comes from a delete or from an undo.
