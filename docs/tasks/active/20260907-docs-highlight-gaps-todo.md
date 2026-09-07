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

- [ ] Add `drawInlineRunBackgroundsForLine` to `paint-layout.ts`:
      span coalescing, break on image runs / no-bg runs / colour change,
      skip `'\n'` runs (they neither extend nor split a span).
- [ ] Use it in `drawInlineRunBackgroundsForLayout` (slides/board path).
- [ ] Use it in `drawInlineRunBackgroundsForPage` (docs body path).
- [ ] Use it in `table-renderer.ts`'s inline-background sweep.
- [ ] Round both edges in `renderRun`'s own per-run fill (header/footer
      path, which has no line-level sweep).
- [ ] Stop `paintLayout` double-painting backgrounds (its sweep already
      covered the layout; `renderRun` repainting per-run rects on top of
      the coalesced band would re-band a translucent highlight).
- [ ] Regression tests in `packages/docs/test/view/paint-layout.test.ts`:
      contiguity across colour spans, one band per line, justify reaches
      the last run's right edge, `'\n'` runs don't split a band.

## Out of scope

PDF export (`export/pdf-painter.ts`) has an independent metric-source
mismatch — a separate defect, per the issue.
