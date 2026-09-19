# Close the dash round trip (issue #1075)

Three follow-ups left open by #1074, which made shapes, action buttons
and connectors actually render `Stroke.dash`.

## 1. PPTX import drops `dash`

`parseShapeStroke` (`packages/slides/src/import/pptx/shape.ts`) reads
`<a:ln w>` and `<a:solidFill>` and returns `{ color, width }`. There is
no `prstDash` read anywhere under `import/`, while `export/pptx/shape.ts`
already writes one via `DASH_VAL`. So a PowerPoint deck with a dashed
border imports as solid — and since #1074 the app renders that *faithfully*,
which makes the loss silent rather than obvious.

**Fix:** read `<a:prstDash val>` in `parseShapeStroke` and map the
`ST_PresetLineDashVal` vocabulary back onto `'solid' | 'dashed' | 'dotted'`
— the inverse of `DASH_VAL`, with OOXML's several dot/dash variants
collapsing onto our three.

- [x] `DASH_BY_PRST` (a `Map`, matching `DASH_VAL`'s reason: `val` is
      attacker-controlled XML and an object lookup consults the prototype)
- [x] `parseShapeStroke` reads it; absent ⇒ no `dash` key written (the
      round trip must not grow a `dash: 'solid'` the source did not have)
- [x] Import unit tests over a hand-written slide, one per bucket
- [x] Export→import round-trip test

## 2. Dash patterns are fixed px in a scaled user space

`dashArray()` returns constant px (`dashed → [6,4]`, `dotted → [2,2]`).
OOXML defines the same presets as *multiples of the line width*, which is
the vocabulary the exporter already maps into. So a 16px dotted border
reads as a solid bar on the canvas, and `DASH_PREVIEW_MAX_WEIGHT` in
`toolbar/stroke-preview.tsx` is a workaround for the same symptom in the
menu — its existence is the tell that the model is wrong.

**Fix:** `dashArray(dash, width)` scaling the pattern by the stroke width.

- [x] `dashArray(dash, width = 1)` multiplies the base pattern by `width`
- [x] All six painter call sites pass their `stroke.width`
- [x] `DASH_PREVIEW_MAX_WEIGHT` and `DashPreview` deleted; both toolbar
      menus now preview at the real weight
- [x] `render-context` unit test pins the scaling with literals; the
      renderer tests compare against `dashArray()` so they cannot drift
- [x] `docs/design/slides/slides-toolbar-redesign.md` updated

Deliberately **not** dividing the pattern by the canvas ctm: PowerPoint
scales dashes with the zoom, so the low-zoom/thumbnail degradation the
issue notes is what matching it costs. Called out in the PR rather than
changed silently.

The base ratios stay `[6,4]` / `[2,2]` rather than becoming OOXML's exact
`dash` 4:3 and `sysDot` 1:1 multiples: at `width: 1` — every stroke the
app has shipped so far — that keeps the rendered result byte-identical,
so this change is visible only where it was already wrong (thick borders).

## 3. The editor hangs on `Loading…` without reaching Yorkie

Reported as blocking visual verification. The issue itself says it needs
a logged-in reproduction before assuming `/d/:id` and `/shared/:token`
share a cause, and names no fix. Not addressed on this branch — see the
PR's "could not verify" note.

## Non-goals

- New dash styles beyond `solid | dashed | dotted`
- Dividing the dash pattern by the current canvas scale
- Per-side shape borders; the docs/sheets border controls
