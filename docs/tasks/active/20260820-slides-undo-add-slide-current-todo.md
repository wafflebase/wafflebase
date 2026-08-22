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

Heal the cursor on the store's change channel, so every removal path
(undo, redo, a peer's delete, a local `removeSlides`) is covered by one
rule rather than each call site remembering to move the cursor:

- Track `currentIndex` — the index `currentId` was last resolved at.
- The editor subscribes to `store.onChange` itself (constructor +
  `setStore`, dropped in `detach`) and revalidates the cursor there in
  `healCurrentSlide()`: a missing id in a non-empty deck moves to the
  slide just before the vanished index (for an undone insertion that is
  the slide the user came from); an unset cursor is re-seeded when slides
  come back, so an emptied deck is a resting state and not a dead end.
  `onCurrentSlideChange` subscribers are notified either way.
- The hook is deliberately the change channel and not the paint path:
  every host drives the store but not every host drives a render loop
  (mobile edit mode mounts the editor with no RAF tick and no
  `onChange → markDirty` wiring), and healing while painting would fire
  host presence writes from inside a RAF frame.
- `render()` / `repaintOverlay()` keep calling `resolveCurrentSlide(doc)`,
  now a pure lookup over the snapshot they already hold — no read added,
  and it stays *after* `render()`'s idle short-circuit (see
  `render-idle-short-circuit.test.ts`). It falls back to healing inline
  only for a store that publishes no `onChange` (the method is optional
  on `SlidesStore`), which has no other moment to notice a removal.
- Discard interaction state anchored to the **removed** slide (crop
  session, in-place text edit) — it can no longer commit anywhere — and
  clear the view-local chrome scoped to the slide the cursor left
  (drill-in scope, element + cell selection, hover outline / insert
  ghost, guide / table-resize / connector previews). An edit anchored to
  a slide that still exists is left alive, matching `setCurrentSlide`.
- The thumbnail panel's `Delete slide` moves the cursor to its chosen
  survivor **before** committing the removal, so its policy and the heal
  don't both fire on the same event.

## Tasks

- [x] Read the editor's current-slide resolution paths
- [x] Add `currentIndex` + `resolveCurrentSlide()` and wire both call sites
- [x] Move the heal onto `store.onChange`; keep a paint-path fallback for
      stores without a change channel
- [x] Unit test: undo of `Add slide` lands on the previously-current slide
- [x] Unit test: remote-style removal of the current slide heals too
- [x] Unit test: the heal cancels a text edit / crop session anchored to
      the removed slide (exercises the re-entrant `render()` path)
- [x] Unit test: an edit on a surviving slide is kept; a host with no
      render loop still heals; an emptied deck re-seeds when it returns
- [x] Confirm the existing `render-idle-short-circuit` suite stays green
      (the heal must add no `store.read()` on a clean frame)

## Acceptance criteria (from the issue)

- After undoing `Add slide`, the editor is on a slide that exists — the
  one that was current before the insertion.
- Any removal of the current slide moves the cursor somewhere valid,
  whether it comes from a delete or from an undo.
