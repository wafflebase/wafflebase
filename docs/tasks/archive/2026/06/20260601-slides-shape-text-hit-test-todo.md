# Slides: hit-test text-only shapes on click

## Context

Reported: clicking a text box on a shared slides deck (PPTX-imported
"Multicolor Pastel Doodle ... Proposal Presentation") is hard — the
user has to land on a glyph stroke to select. Other clicks miss.

Investigation (this session):

- The share-link role is `editor`, so `readOnly=false`, and
  `attachInteractions()` runs as normal.
- Dumping the first slide's elements via the live editor shows all
  three text containers are `type:'shape'`, `kind:'rect'`, with
  `data.text` set and **no `fill`, no `stroke`**. The PPTX importer
  emitted them via the `prstGeom + txBody` branch (`shape.ts:439-446`,
  introduced by #321 "edit text inside shapes").
- `packages/slides/src/view/editor/element-hit.ts:116-119` rejects any
  shape with `!hasFill && !hasStroke` regardless of `data.text`. So a
  shape that only paints text is invisible to hit-testing even though
  the renderer paints the text on top.

This regressed when shape text was folded into `ShapeElement.data.text`
— the visibility gate was not updated to account for the new "text-only
shape" case.

## Plan

1. **Failing test** — add a case in
   `packages/slides/test/view/editor/hit-test-elements.test.ts` (or a
   colocated `element-hit.test.ts`) that builds a `kind:'rect'` shape
   with `data.text` set and no `fill`/`stroke`, and asserts that
   `hitTestSlide` returns it for a point in the bbox interior.
2. **Fix** — extend the visibility gate in
   `packages/slides/src/view/editor/element-hit.ts:hitShape` so that
   `hasText` participates:
   - `if (!hasFill && !hasStroke && !hasText) return false;`
   - Treat `hasText` like `hasFill` for the path-interior test
     (`isPointInPath` returns hit). Stroke band fallback stays the
     same.
3. **Verify** — `pnpm verify:fast` green. Browser smoke on the
   originally-reported shared link: clicks on the title / body shapes
   on slide 1 select the shape.

## Non-goals

- Per-glyph or per-line text bbox hit zones (considered + rejected
  this session — too expensive without a layout cache, and PowerPoint
  / Google Slides behavior is "bbox interior is clickable for
  text-occupied shapes").
- Empty-placeholder hint-only hit zone (separate concern; the
  fix here only addresses shapes with committed text content).

## Review

Two coupled changes were needed; the gate fix alone was not enough:

1. **`packages/slides/src/view/editor/element-hit.ts`** — extended the
   visibility gate in `hitShape` to include `hasText`. Text-only
   shapes (`!hasFill && !hasStroke && hasText`) now pass the gate and
   are treated like filled shapes for the path-interior test
   (`isPointInPath`).

2. **`packages/slides/src/view/editor/editor.ts`** — added
   `hitTestAt(slide, x, y)` that wraps `hitTestSlide` in
   `ctx.save() / setTransform(1,0,0,1,0,0) / restore()` and updated
   all four call sites (format-paint, context-menu, pointer-down,
   double-click).

   Why this was necessary: `SlideRenderer.renderSlide` leaves the
   canvas ctx with `scale((hostWidth / SLIDE_WIDTH) * dpr)` applied
   (see `slide-renderer.ts:141`). When `isPointInPath(path, x, y)`
   receives a `Path2D` parameter, the path is interpreted through the
   current transform but the query (x, y) is in canvas-pixel space.
   So an interior click in logical units (e.g. lx ≈ 600 on a
   1199-wide rect) ended up well outside the path's scaled-down
   footprint and `isPointInPath` returned `false`. Browser instrumentation
   verified the transform matrix in production was `a = d ≈ 0.267`
   for the originally-reported deck.

   This was a pre-existing latent bug — it affected filled non-rect
   shapes too — but it was masked because:
   - The test canvas's `isPointInPath` ignores transforms entirely.
   - Many decks have stroked rectangles where the stroke-band
     fallback path (`isPointInStroke` with widened `lineWidth`)
     would catch most clicks.

   Text-only shapes have *neither* a fill body nor a stroke band, so
   the transform bug surfaced cleanly here.

Verification:
- New unit test in
  `packages/slides/test/view/editor/hit-test-elements.test.ts`:
  `hits a text-only shape (no fill, no stroke, has data.text)` failed
  pre-fix, passes post-fix. Companion test `does not hit an empty
  shape (no fill, no stroke, no text)` guards the gate negative case.
- `pnpm verify:fast` green (slides 1,560 tests + docs 877 tests).
- Manual browser smoke on the originally-reported share link
  (`/shared/e41ba148-...`): clicked the centres of the three text
  shapes on slide 1; all three select correctly via
  `editor.selection.get()`. Pre-fix, all three clicks landed on the
  back-most full-bleed image (`7cb34fec`).

Non-goal — text-glyph-only hit zone — remains future work. Considered
this session but rejected because it adds `computeLayout` cost to
every hit-test and changes UX in a deck-template-dependent way.

Note on perf — the `hitTestAt` wrapper costs one `save` + one
`setTransform(identity)` + one `restore` per click / pointer-move
hit-test. The slide renderer already does the same cycle in its
paint path, so the overhead is negligible.

## Self-review follow-ups

Two corrections from the self-review pass after the initial fix:

- **`OPEN_PATH_KINDS` guard on the text branch** — the first cut wrote
  the path-interior gate as `if (hasFill || hasText)`. That bypassed
  the bracket / brace exclusion `hasFill` already carries (PR #266,
  commit `5b6197ef`, introduced `OPEN_PATH_KINDS` precisely because
  `isPointInPath` auto-closes an open polyline into a misleading C /
  U interior). A `leftBracket` shape carrying `data.text` with no
  fill / no stroke would have falsely hit across the auto-closed
  region. Pulled the guard out of `hasFill` and put it on the path
  test itself: `if ((hasFill || hasText) && !OPEN_PATH_KINDS.has(el.data.kind))`.
  Bracket / brace shapes with text now fall through to the stroke-band
  test instead, matching how the renderer treats them. Added a
  regression test
  (`does not hit OPEN_PATH_KINDS interior even when shape has text`).
- **`hitTestElement` JSDoc** — refreshed the contract bullets so the
  function-level docblock reflects the new `hasText` clickability
  source. The body comments and the doc header were out of sync
  otherwise.

