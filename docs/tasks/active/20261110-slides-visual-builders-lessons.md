# Slides Visual Builders — Lessons

## Font sizes are points

- The docs layout engine paints `fontSize` at `pt × 96/72` px. The original
  compositions sized text as if `fontSize` were px: `bigNumberCard` fitted
  the figure with `0.62 × fontSize` per character and floored at 56, and
  `codeBlock` sized its panel at `lines × fontSize × 1.4`. A 128pt figure is
  171px tall; "87건" at 128pt is wider than a 400px card, and a CJK unit
  breaks onto its own line because CJK text may break between any two
  characters. The code panel was ~25% shorter than its text.
- All fit checks now go through `textWidthPx(text, pt, bold)`, the linter's
  own `estimateMeasurer` in px with an 8% margin (its per-class averages
  run short on words heavy in `m`/`w`: "Payments" wrapped at 20pt).
- Shapes lay text inside the OOXML preset text rectangle, not the frame: a
  `roundRect` insets ~4.9% of its width per side (122px on a full-width code
  panel), a diamond 25%. `SHAPE_TEXT_RECT_FRACTIONS` is now exported from
  the node entry so the builders size text against the real box.

## Export findings

- PPTX export drops `chart` elements (`elementToXml` returns `''`; chart
  serialization was deferred to a Phase 2 that has not landed). `chart()`
  therefore draws with native shapes by default; `native: true` is the
  in-app/PDF-only escape hatch. The native chart painter also renders its
  labels very small at 1920px, another reason for the default.
- Connector export lost the drawing direction: `<a:xfrm>` had no
  `flipH`/`flipV`, so an arrow drawn right-to-left or bottom-to-top came
  back reversed. It also used the canvas frame, padded by half the stroke
  width on both axes, so a horizontal 3px arrow exported 3px tall and
  re-imported tilted. Fixed in `connectorExportFrame`.
- Still not exported: connector attachments (`stCxn`/`endCxn`). Elbows
  export as `bentConnector3` with the default adjust, so a looping elbow
  (a back edge in `flow`) becomes a Z in PowerPoint.
- `freeform` shapes export as `<a:custGeom>`, which is why icons and line
  series are freeforms rather than SVG images: they keep theme colour and
  survive PPTX.

## Icons

- The renderer strokes with butt caps, so a zero-length segment (the
  usual "dot") vanishes and a tiny circle shows as a ring. A 0.6-unit
  closed square filled in by its round-joined stroke reads as a dot.
- OOXML `arcTo` is pen-relative, so every `A` command must start where the
  pen is; the spec checks that for every icon.

## Rendering

- `pnpm frontend render:slides` needed Playwright's `chromium_headless_shell-1208`;
  the container had 1243. A symlink outside the repo was enough. Chromium
  here has no Korean web fonts, so Hangul falls back to a system face and
  `Nanum Gothic Coding` cannot be checked visually in this environment.

## Self review

- No separate reviewer could be launched from this agent run; the
  self-review loop in CLAUDE.md step 3 is left for the PR owner.
