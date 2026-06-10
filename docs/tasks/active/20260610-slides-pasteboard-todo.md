---
title: slides pasteboard v1
status: in-progress
owner: hackerwins
created: 2026-06-10
---

# Slides Pasteboard v1

Make shapes that extend (or sit entirely) outside the slide canvas
remain visible, hit-testable, and selectable — matching PowerPoint's
pasteboard model. Today the canvas DOM is sized exactly to the slide
rect, so anything beyond `[0, SLIDE_WIDTH] × [0, SLIDE_HEIGHT]` is both
clipped from rendering AND unreachable for pointer events.

This v1 introduces a fixed pasteboard margin around the slide. The
slide rect keeps its visual identity (background fill, drop shadow);
the surrounding pasteboard area gets a neutral background and accepts
pointer events. Off-slide elements render onto the enlarged canvas
exactly as in-slide elements do, so the user can see and grab them.

## Goals

- Off-slide shape (partial or fully outside slide rect) is selectable.
- Off-slide shape is visible (rendered on the pasteboard).
- Slide visual identity preserved: slide-bg fill + drop shadow + edge.
- No coordinate-model changes for existing call sites (selection
  overlay, smart guides, snap, hit-test) beyond the single
  client→logical translation.

## Non-goals (v1)

- Ruler 0-tick re-alignment to slide-left/top (rulers continue to
  use slide-only host size; minor misalignment in pasteboard mode
  is acceptable for the first cut).
- Thumbnail panel changes — thumbnails still render slide-only.
- Variable pasteboard size / zoom-dependent shrink.
- PowerPoint-style Selection Pane.

## Design

See [`docs/design/slides/slides-pasteboard.md`](../../design/slides/slides-pasteboard.md).

Key idea: keep slide-fit math unchanged (slide stays its original
Fit-zoom size). Grow the canvas / canvasWrap to fill `scrollHost`
so the empty area around the slide becomes a paint + pointer
surface. The slide's logical offset inside the canvas (computed per
`refitCanvas` from `scrollHost.getBoundingClientRect()`) is wired
through to the renderer (`slideOffsetLogicalX/Y` option) and the
editor (`setSlideOffset` method + `clientToLogical` subtraction).

## Tasks

- [x] Write todo + design doc (v1 fixed-margin draft).
- [x] First-pass implementation with fixed `PASTEBOARD_LOGICAL` (240
      logical px). Smoke test feedback: slide looked too small at
      Fit zoom — slide shrinks 20 % to make room for pasteboard.
- [x] Revise to variable pasteboard:
  - [x] Remove `PASTEBOARD_LOGICAL` constant and `pasteboardFitFactor`
        slide-shrink math.
  - [x] Rename renderer option to `slideOffsetLogicalX/Y`; clearRect
        reads `ctx.canvas.{width,height}` instead of computing from
        a fixed margin.
  - [x] Editor: add `setSlideOffset(x, y)` method + interface entry;
        `clientToLogical` subtracts both offsets.
  - [x] `slides-view.tsx`: size canvas / canvasWrap to
        `max(slide, scrollHost)`, center slide inside, push the
        offsets into the editor on every `refitCanvas`.
- [x] `pnpm verify:fast` green.
- [ ] Smoke-test in `pnpm dev`: drag a shape off the slide, click on
      it on the pasteboard, drag it back. Awaiting feedback.

## Risks

- Canvas DOM grew → bigger bitmap memory footprint per slide
  (margin = 240 logical px ≈ 12.5% extra per axis, ≈ 27% area).
  Acceptable at 1 active slide; thumbnails unaffected.
- Drop shadow now painted into canvas (was CSS `box-shadow`); subtle
  visual differences may appear under high zoom. Will verify in
  smoke test and adjust shadow params if needed.
- Pasteboard-area click → editor's existing pointermove cursor
  resolution path must handle logical coords outside slide rect
  without crashes. Today's hit-test already does (no bounds
  assertions); guides/snap may produce unexpected matches when
  hovering far off-slide.
