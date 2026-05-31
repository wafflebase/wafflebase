# Slides — Body-area click deselects shapes

## Context

Currently in the slides editor a shape stays selected when the user
clicks the gray area surrounding the slide canvas. Only clicks landing
on the slide canvas itself trigger deselection (via the empty-canvas
branch of `onPointerDown`). Google Slides deselects on clicks anywhere
in the editor body (the area bracketed by the rulers).

Scope: limit the new listener to the ruler-bracketed editor body
(the `scrollHost` element). Avoid a global `document`-level listener
so toolbar / side panel / format panel clicks remain inert with
respect to selection.

## Plan

- [ ] Extend `SlidesEditorOptions` with optional `bodyHost?: HTMLElement`.
- [ ] In `attachInteractions`, bind `pointerdown` on `bodyHost` and
      fire `onBodyPointerDown` only when `e.target === bodyHost`
      (i.e., the click landed on the empty area, not on a child like
      the canvas wrap or the rulers).
- [ ] `onBodyPointerDown` behavior:
  - During paint/insert mode → no-op (user is in a different gesture
    domain; missing the canvas shouldn't clear or insert).
  - While text editing → commit + exit (mirrors clicking outside the
    text-box container while still inside the slide canvas).
  - Otherwise → `selection.click(null, {})` with `refitPoppedScope` so
    drilled-in groups pop on body click, matching the empty-canvas
    branch of `onPointerDown`.
- [ ] Pass `scrollHost` as `bodyHost` in `slides-view.tsx`.
- [ ] Unit test: dispatch `pointerdown` with `target === bodyHost`
      clears selection; dispatch with a child target does not.
- [ ] `pnpm verify:fast` green.

## Notes

- `attachInteractions` already short-circuits in read-only mode, so the
  new binding inherits that gate without extra plumbing.
- The mobile shell (`mobile-slides-view.tsx`) does not own a comparable
  ruler-bracketed body region today; leaving it unwired keeps the
  mobile gesture surface unchanged.
