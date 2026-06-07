# Slides: noSmoking union-outline fix

**Owner:** @hackerwins
**Date:** 2026-06-01

## Why

The `noSmoking` ("No symbol") shape currently paints a stray rectangular
outline where the diagonal slash crosses the ring, and the slash band's
NW/SE corners overrun the outer circle by a short stub. The cause is
three separate closed sub-paths (outer ring CW + inner ring CCW + slash
band CW) inside one `Path2D`: `ctx.fill('nonzero')` correctly merges
them into a single silhouette, but `ctx.stroke(path)` traces every
sub-path's full perimeter independently — so the band's two long edges
appear inside the ring, the inner circle is stroked straight across the
band, and the band overshoots the outer circle.

`mathNotEqual` and `mathMultiply` already solved the same pattern by
tracing the **union outline** as a single connected path. The
`buildNoSmoking` source comment explicitly flags this as V0 work: *"V0
uses a thick polygon slash; the OOXML preset's exact band-corner
geometry is a follow-up refinement."* This task is that follow-up.

## Scope

- Rewrite `buildNoSmoking` to emit one outer-ellipse loop plus two
  C-shaped inner-hole loops. Each inner hole's boundary is one inner
  ellipse arc (NE side or SW side) joined to a straight slash band edge
  segment.
- Clip the slash to the outer ellipse so the NW/SE band corners land
  *on* the outer perimeter, not past it.
- Keep the single `Band thickness` adjustment, the OOXML thousandths
  semantics, the default value (18750), and the existing top-edge
  handle behavior unchanged.
- Match the band thickness to the ring thickness (`t`) — same as the
  OOXML preset's shared `adj1`.

## Plan

- [x] Add a small inline `lineEllipse` helper (line ∩ axis-aligned
  ellipse, returns the two parametric `s` values) — local to the file,
  not exported.
- [x] Rewrite `buildNoSmoking` to:
  - Compute slash direction `d = (w, h) / |(w, h)|` and perpendicular
    `n = (-dy, dx)`; band edges sit at `±n * t / 2`.
  - Trace the full outer ellipse as a single closed loop (CW).
  - Solve `lineEllipse` against the inner ellipse for both band edges;
    build the NE hole and SW hole as `inner-arc + straight band-edge
    segment + closePath` (each CCW for non-zero hole semantics).
  - Degenerate cases: when the band is wider than the inner ellipse
    along `n` (no `lineEllipse` roots), skip that hole; when `irx`/
    `iry` collapse to zero, skip both holes.
- [x] Extend `no-smoking.test.ts`:
  - A point inside the ring annulus is filled.
  - A point inside the slash band (and outside the ring) is filled.
  - A point in the NE inner hole (above-right of the slash, inside the
    inner ellipse) is **not** filled.
  - A point in the SW inner hole is **not** filled.
  - A point just past the outer ellipse along the slash diagonal is
    **not** filled (no slash overshoot).
- [x] `pnpm verify:fast` green.
- [x] Visual check in `pnpm dev`: insert noSmoking, confirm fill and
  stroke both clean.

## Out of scope

- Other shapes with intentional overlapping subpaths (`smileyFace`,
  `horizontalScroll`, `verticalScroll`, `stripedRightArrow`, `cube`,
  `frame`, `foldedCorner`, action buttons) — those outlines are part of
  the design.
- `bevel`'s separate fidelity gap (comment promises four trapezoidal
  facet sub-paths; code emits only outer + inner rects). Tracked
  separately if needed.
- Adjusting the picker SVG icon — driven from the same path builder,
  so it inherits the fix automatically.
