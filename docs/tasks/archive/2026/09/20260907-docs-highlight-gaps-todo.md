# Docs: highlight background paints gaps between words (#1036)

## Problem

Inline highlight (`style.backgroundColor`) renders with unpainted slivers
between words, from two mechanisms:

1. **Sub-pixel seam** — the background painters round the rect's *left*
   edge (`Math.round(pageX + pl.x + run.x)`) but pass the *raw float*
   `run.width`, so rect `i` ends at `round(X) + w` while rect `i+1`
   starts at `round(X + w)`. Roughly half of all word boundaries leave a
   gap of up to ~0.5 logical px, amplified by dpr and zoom.
2. **Justify** — `applyAlignment('justify')` shifts `run.x` without
   growing `run.width`, so a per-run background leaves real multi-pixel
   gaps between words.

## Approach

Take the issue's "complete" variant: coalesce, per line, maximal spans of
consecutive runs that resolve to the same background colour and emit one
rect from `round(first.x)` to `round(last.x + last.width)`. Rounding both
edges makes adjacent spans provably contiguous (run `i+1`'s left
expression *is* run `i`'s right expression); coalescing closes the
justify gaps.

One helper in `paint-layout.ts`, reused by every call site.

## Steps

- [x] Add `drawInlineRunBackgroundsForLine` to `paint-layout.ts`:
      span coalescing, break on image runs / no-bg runs / colour change,
      skip `'\n'` runs (they neither extend nor split a span).
      **v0.6.10 audit — verified by reading the code:** `paint-layout.ts:239`; `flush()` at :251 rounds both edges (:253-254), `'\n'` skipped at :263, no-bg/image flush at :265-271, colour-change break at :272.
- [x] Use it in `drawInlineRunBackgroundsForLayout` (slides/board path).
      **v0.6.10 audit — verified by reading the code:** `paint-layout.ts:289`, calls it at :308.
- [x] Use it in `drawInlineRunBackgroundsForPage` (docs body path).
      **v0.6.10 audit — verified by reading the code:** `paint-layout.ts:330`, calls it at :351; consumed by `doc-canvas.ts:417`.
- [x] Use it in `table-renderer.ts`'s inline-background sweep.
      **v0.6.10 audit — verified by reading the code:** `table-renderer.ts:224`, inside the per-cell line loop (import at :14).
- [x] Round both edges in `renderRun`'s own per-run fill (header/footer
      path, which has no line-level sweep).
      **v0.6.10 audit — verified by reading the code:** `paint-layout.ts:481-497` — `x = Math.round(lineX + run.x)` and `bgRight = Math.round(lineX + run.x + run.width)`, filled at :494.
- [x] Stop `paintLayout` double-painting backgrounds (its sweep already
      covered the layout; `renderRun` repainting per-run rects on top of
      the coalesced band would re-band a translucent highlight).
      **v0.6.10 audit — verified by reading the code:** `paint-layout.ts:120-122` gates the sweep on `!skipRunBackgrounds`; `paintBlock` passes `skipBackground: true` unconditionally at :190, reason at :136-140.
- [x] Regression tests in `packages/docs/test/view/paint-layout.test.ts`:
      contiguity across colour spans, one band per line, justify reaches
      the last run's right edge, `'\n'` runs don't split a band.
      **v0.6.10 audit — verified by reading the code:** `packages/docs/test/view/paint-layout.test.ts:375` `describe('inline highlight bands (issue #1036)')` — continuous band :376, two-colour adjacency :391, justified line :402, `'\n'` :424, break-at-unhighlighted :434.

## Out of scope

PDF export (`export/pdf-painter.ts`) has an independent metric-source
mismatch — a separate defect, per the issue.
