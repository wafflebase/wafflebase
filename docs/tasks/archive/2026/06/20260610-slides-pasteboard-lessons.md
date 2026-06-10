---
title: slides pasteboard v1 — lessons
owner: hackerwins
created: 2026-06-10
related: 20260610-slides-pasteboard-todo.md
---

# Slides Pasteboard v1 — Lessons

## Iterations

This task ran three implementation cycles, each driven by a user-facing
smoke-test outcome:

1. **Fixed-margin pasteboard (PASTEBOARD_LOGICAL = 240)** — extended
   canvas + canvasWrap + overlay by a constant 240 logical px on each
   side, shrinking the Fit-zoom slide by ~20 % to keep the canvas
   within the column. Smoke verdict: *"화면이 더 좁아 보임"* — the
   slide visibly shrank.

2. **Variable pasteboard (scrollHost-based)** — reverted the
   `pasteboardFitFactor` slide-shrink math, sized `canvas` /
   `canvasWrap` to `max(slide, scrollHost)`, and centered the slide
   inside via per-tick `slideOffsetLogicalX/Y`. Slide back to original
   size; pasteboard becomes whatever empty area surrounds it. Smoke
   verdict: *"PASTEBOARD 영역의 색상이 구분될 필요는 없음"* — pasteboard
   should blend into the workspace, not stand out.

3. **Transparent canvasWrap + CSS elevation div** — set
   `canvasWrap.style.background = "transparent"` so the band blends
   into the parent's workspace color, then (after code review)
   relocated the slide's hairline + drop shadow to a dedicated
   `slideElevation` absolute div positioned at the slide rect.
   Shipped as PR #353.

## What worked

- **Each smoke loop produced a single concrete signal.** The user did
  not redesign; they reported one thing that felt off ("too small",
  "stands out", "blend in") and let me adjust. Resisting the urge to
  guess at multiple changes per iteration kept the diffs small and
  the review thread legible.
- **Splitting "slide elevation" from "slide background fill" by
  putting elevation in CSS and fill in canvas.** The first attempt
  painted the drop shadow inside `drawSlide`, which made the shadow
  bound to the pasteboard branch — invisible at zoom > Fit. Moving
  elevation to a CSS `box-shadow` on a sibling div made it survive
  every paint mode for free.

## What I'd do differently

- **The first design pass should have separated reachability from
  rendering.** I conflated "off-slide shapes can't be selected"
  (a pointer-events problem) with "off-slide shapes can't be seen"
  (a rendering problem). Treating them as one cost an entire
  iteration on the shrink-the-slide approach. Next time, I'll
  pre-commit to one axis: either grow the event-catching area only
  (cheap, off-slide shapes still invisible) or grow the paint
  surface only (what we shipped). Mixing both at once led to the
  shrink.
- **Theme-reactive styling should never move from CSS to canvas
  paint without an explicit reason.** I migrated the slide hairline
  from `color-mix(in srgb, var(--foreground) 25%, …)` to a
  hardcoded `rgba(0,0,0,0.10)` and lost dark-mode parity. The
  original CSS comment flagged it as load-bearing — I had to put it
  back during code review. Default should be: if the existing
  styling uses CSS tokens, the new path must too.
- **Sub-pixel CSS positioning needs `Math.floor`, not `/ 2`.**
  When computing centering offsets from two values with different
  rounding modes (`Math.floor` vs `Math.round`), the divide will
  land on `.5` half the time. The reviewer caught it; future
  centering helpers should snap to integer CSS px by default.

## Cross-cutting

- Self-review (9 finder angles + verify + sweep) caught three real
  regressions the implementation pass missed (shadow, hairline,
  half-pixel offset) plus one latent test-mock gap. The pattern is
  worth keeping for any change that touches a paint pipeline + DOM
  layout in lockstep.
