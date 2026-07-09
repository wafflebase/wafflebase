# Slides Charts — Lessons

## PPTX / import

- **`<p:graphicFrame>` is polymorphic.** Tables, charts, SmartArt, and OLE
  objects all arrive as `graphicFrame`; disambiguate on
  `<a:graphicData@uri>`, not on the presence of a child. The old code
  routed everything to `parseTable`, which returned `[]` for anything that
  wasn't `<a:tbl>` — a silent, uncounted drop. Any "frame" importer needs
  a report counter so lossy paths are visible.
- **Charts carry frozen values.** `<c:numCache>`/`<c:strCache>` hold what
  PowerPoint last computed, indexed by `<c:pt idx>`. Read them
  positionally (index into an array, back-fill holes) so category↔value
  alignment survives sparse indices — do not append in document order.
- **`xml.ts` `child`/`attr`/`descendant` do NOT tolerate `undefined`.**
  Every lookup on a possibly-missing node must be ternary-guarded; the
  plan's draft snippets passed `child(sers[0], ...)` unguarded and would
  have thrown on empty series. Guard at write time, not via the type
  checker.
- **jsdom tag lookups are prefix-fragile.** `getElementsByTagName('a:t')`
  happened to work but `getElementsByTagName('t')` found nothing — match
  the project's own local-name convention (`el.localName === 't'`) instead
  of relying on namespaced tag names.

## Rendering / PDF

- **Slides PDF export is raster, not vector.** `exportSlidesPdf` draws
  each slide through `drawSlide()` onto an offscreen canvas, encodes
  PNG/JPEG, and embeds the image with pdf-lib — there is no per-glyph font
  embedding. So a canvas-native painter reaches PDF for free, and chart
  text (drawn with the generic `sans-serif` keyword) needs no font work.
  The plan inherited a `collectTextBodies`/font-embedding assumption from
  the **docs** PDF export (which IS vector); slides differ. Verify the
  actual pipeline before wiring "font embedding."
- **A new `Element` union member ripples into the PPTX export switch.**
  Adding `'chart'` broke `elementToXml`'s exhaustiveness in
  `export/pptx/group.ts`; the pragmatic fix was a throwing `case 'chart'`
  (export is Phase 2). A graceful skip-with-report would be better once
  export is wired.

## Process

- **Don't let a brittle test dictate visuals.** Task 6 first drew legend
  swatches as circles purely so a prior task's exact `fillRect`-count
  assertion stayed green. The right fix was to scope the old test
  (`legend: 'none'` fixture) and keep conventional square swatches. When a
  test and a design choice collide, check which one is actually wrong.
- **Placeholder assertions in a plan are scaffolding, not spec.** Tasks 7
  and 8 shipped with `expect(true).toBe(true)` in the plan text; the
  dispatch must force the implementer to read the real source, find the
  real function names (`hitTestSlide`, `exportSlidesPdf`,
  `collectFontFamilies` — none matched the plan's guesses), and write real
  assertions.
