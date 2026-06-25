# PPTX import: preserve fill/border on `txBox="1"` text boxes

## Problem

On an imported deck (slide 7 of "Yorkie 실시간 동시 편집 적용하기.pptx"), the
"Network Interruption" box renders behind a connector line — its white
background is gone, so the dark line shows through the box. In the
original PPTX the box sits above the line in z-order and covers it.

## Root cause

The box is a Google-Slides-exported text box: a `<p:sp>` with
`<p:cNvSpPr txBox="1"/>` that carries an explicit `<a:solidFill>`
(white, `schemeClr lt1`) background **and** an `<a:ln>` black border.

`parseSp` (`packages/slides/src/import/pptx/shape.ts`) routed every
`txBox="1"` shape through `buildTextElement`, which only parsed the text
body and **dropped** the fill/stroke — on the assumption "text boxes have
no fill/stroke". So the box imported as a transparent `TextElement`, and
the connector line (drawn just before it in z-order) showed through.

The model (`TextElement.data.fill`/`stroke`), the renderer
(`text-renderer.ts` paints both), and the PPTX exporter
(`textElementToXml` writes both) all already supported a filled/bordered
text box — only the importer was dropping the data.

## Plan

- [x] Reproduce: confirm slide-7 box is `txBox="1"` + `solidFill` + `ln`
- [x] Confirm model/renderer/exporter already support text-box fill+stroke
- [x] Failing test: filled+bordered `txBox="1"` keeps `data.fill`/`stroke`
- [x] Fix: parse fill/stroke in the `isTextBox` branch, thread into
      `buildTextElement`
- [x] Verify on the real `slide7.xml` (schemeClr fill resolves to a role)
- [x] Full slides test suite + sheets gate green

## Review

- Fix is 2 spots in `shape.ts`: the `isTextBox` branch now calls the
  existing `parseShapeFill`/`parseShapeStroke` and passes the results to
  `buildTextElement`, which gained two optional params.
- No model/renderer/exporter change needed — round-trip stays symmetric.
- Tests: `test/import/pptx/shape.test.ts` gains a regression case; full
  slides suite 2274 pass / 2 skip; sheets 1279 pass.
- Known unrelated failure: `test/anim/player.test.ts` `.at()` typecheck
  error (pre-existing, CI never runs that gate).
