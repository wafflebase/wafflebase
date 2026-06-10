---
title: slides-pasteboard
target-version: 0.2.0
---

# Slides Pasteboard (v1)

## Summary

Treat the empty area inside `scrollHost` that surrounds the slide
rect as a "pasteboard". Off-slide shapes that fall in that area
stay rendered, visible, and pointer-reachable instead of being
clipped by a slide-only canvas.

Today `canvasWrap`, `<canvas>`, and `overlay` are all sized exactly
to the slide host (`hostWidth × hostHeight` CSS px). Anything outside
slide-logical `[0..1920] × [0..1080]`:

- is not rendered (lands outside the canvas bitmap), and
- cannot receive pointer events (lands outside the canvas DOM box).

A first attempt added a fixed pasteboard margin around the slide,
but that visibly shrank the slide at Fit zoom. v1 instead uses a
**variable pasteboard sized from the surrounding empty area**: the
slide rect keeps its original Fit-zoom size, while the canvas grows
to fill `scrollHost`. Whatever empty space sits between the slide
and `scrollHost`'s edges becomes the pasteboard.

## Goals / Non-goals

### Goals

- Off-slide shape (partial or fully outside slide rect) is selectable
  and visible whenever it lands inside `scrollHost`.
- Slide stays its original Fit-zoom size — no perceived shrink.
- Existing in-slide interactions unchanged.
- Slide visual identity preserved: slide background fill + drop
  shadow + pasteboard background color.

### Non-goals (v1)

- Off-slide shapes when zoom > Fit (canvas equals slide, no extra
  pasteboard band). User drops to Fit to recover; documented limit.
- Ruler 0-tick re-alignment to slide-left/top.
- Thumbnail panel changes — thumbnails render slide-only.
- PowerPoint-style fixed pasteboard extending beyond the viewport.

## Proposal Details

### Coordinate model

Three coordinate spaces. The slide-fit math is unchanged; only the
canvas wrap dimensions grow.

| Space | Range | Notes |
|-------|-------|-------|
| Logical (world) | `[-Ox .. SLIDE_WIDTH + Ox]` × `[-Oy .. SLIDE_HEIGHT + Oy]` | `Ox`, `Oy` are the slide's logical offset inside the canvas |
| Slide host CSS px | `hostWidth × hostHeight` | unchanged — slide-only fit |
| Canvas DOM CSS px | `max(hostWidth, scrollHostW) × max(hostHeight, scrollHostH)` | grows to fill `scrollHost` |

`scale = hostWidth / SLIDE_WIDTH` (CSS px per logical px) is
unchanged. `slideOffsetCss = (canvasFull - slideHost) / 2`;
`slideOffsetLogical = slideOffsetCss / scale`.

### DOM shape

```
canvasArea (overflow: hidden, rulers pinned)
└── scrollHost (overflow: auto, centered)
    └── canvasWrap (max(slide, scrollHost), neutral CSS background)
        ├── canvas (max(slide, scrollHost), transparent in pasteboard area)
        └── overlay (slide-host sized, positioned at slide offset)
```

`overlay` stays slide-host sized at the slide rect — handle children
position via `world * scale` exactly as today. Handles for off-slide
selections naturally overflow `overlay`'s box and remain interactive
(absolute children with `pointer-events: auto`).

### Renderer

`drawSlide` adds `slideOffsetLogicalX` + `slideOffsetLogicalY` to
`SlideRendererOptions`. When either is non-zero:

1. `ctx.setTransform(identity)`; `ctx.clearRect(full bitmap)`
   (read from `ctx.canvas.{width,height}` directly).
2. `ctx.scale(scale·dpr, scale·dpr)`.
3. `ctx.translate(Ox, Oy)` — slide-logical origin lands at
   `(Ox·s·dpr, Oy·s·dpr)` in bitmap px.
4. Paint slide background fill + drop shadow restricted to the slide
   rect `(0, 0, SLIDE_WIDTH, SLIDE_HEIGHT)` (+1 px padding to
   absorb aspect-ratio rounding).
5. Existing background-image + element-iteration loop unchanged.

With both offsets `0` (default) the renderer keeps the pre-pasteboard
behaviour, filling the full bitmap with the slide background.

### Editor

- `clientToLogical(clientX, clientY)` subtracts the offsets after
  dividing by scale, so off-slide pointer events yield correct
  negative / `> SLIDE_WIDTH` logical coords.
- `handleAtClient` keeps using `overlay.getBoundingClientRect()` —
  overlay sits at slide rect, so handle coords still align.
- New `setSlideOffset(logicalX, logicalY)` mirrors `setHostSize`.
  The view shell calls both on every `refitCanvas` tick.
- All other coord conversions are derivative of `clientToLogical`
  and don't need updates.

### View shell (`slides-view.tsx`)

`refitCanvas` now also reads `scrollHost.getBoundingClientRect()`:

```
nextCanvasW = max(nextW, scrollHost.width)
nextCanvasH = max(nextH, scrollHost.height)
slideOffsetCssX = (nextCanvasW - nextW) / 2
slideOffsetCssY = (nextCanvasH - nextH) / 2

canvas.width  = nextCanvasW * dpr
canvas.height = nextCanvasH * dpr
canvas.style.width  = `${nextCanvasW}px`
canvas.style.height = `${nextCanvasH}px`

canvasWrap.style.width  = `${nextCanvasW}px`
canvasWrap.style.height = `${nextCanvasH}px`

overlay.style.left = `${slideOffsetCssX}px`
overlay.style.top  = `${slideOffsetCssY}px`

editor.setSlideOffset(
  slideOffsetCssX / (hostW / SLIDE_WIDTH),
  slideOffsetCssY / (hostW / SLIDE_WIDTH),
)
```

`canvas.style.boxShadow` is removed — the shadow is painted into the
canvas around the slide rect so it appears in pasteboard space.

`canvasWrap.style.background` picks up the pasteboard color, e.g.
`color-mix(in srgb, var(--foreground) 6%, var(--background))` so
both light and dark themes get a subtly darker shade than the
workspace.

## Risks and Mitigation

- **Pasteboard is small at Fit zoom width-binding** (~12 px each
  side from `SLIDE_FRAME_GAP`). Acceptable for recovery — the user
  can drag a shape ≤12 px off-slide and still grab it. Bigger
  recovery zone would need a wider `SLIDE_FRAME_GAP` or a fixed
  pasteboard band (which v1 explicitly rejects).
- **Zoom > Fit has no surrounding pasteboard.** Off-slide shapes at
  high zoom are invisible / unreachable; user drops to Fit zoom to
  recover. Documented limitation.
- **Drop shadow moves from CSS to canvas paint.** Subtle visual
  differences may appear at high DPI; smoke-test, tune shadow
  blur / alpha if needed.
- **Off-slide hover paths.** Editor's `onPointerMove` / hit-test
  already accepts arbitrary logical coords with no bounds assertion,
  so no crash expected — but snap candidates and smart guides might
  fire on far-off-slide points. Acceptable for v1; revisit if the
  smoke test shows distracting behavior.
- **Ruler ticks drift from slide-left/top.** Documented as a v1
  limitation; ruler re-alignment is a separate follow-up.
