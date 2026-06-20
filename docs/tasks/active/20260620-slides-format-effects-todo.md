# Slides Format options — per-type effects

Expose Google-Slides-parity editable properties in the slides Format
options panel, routed by element type. Fill/Border stay in the toolbar
(GS parity); the panel gains effect sections.

Design doc: `docs/design/slides/slides-format-effects.md`

## PR 1 — Panel IA + object effects (Shadow · Reflection · Alt text)

- [x] Model: `DropShadow`, `Reflection`, `Effects` types; `effects?` on
      shape/image/text/table/group `data`; `alt?` on shape/text/table `data`.
- [x] Renderer: `applyShadow`/`clearShadow` around shape/image/text paint
      in `element-renderer.ts`. (Reflection offscreen mirror — next.)
- [x] Panel: `pick-sections.ts` routing → `drop-shadow`, `alt-text`
      (extended to shape/text/table). (Reflection routing — next.)
- [x] Sections: `drop-shadow-section.tsx`; `alt-text-section.tsx`
      generalized to all object types. (`reflection-section.tsx` — next.)
- [ ] Reflection: model wired; renderer + section + routing remaining.
- [ ] Import: PPTX `<a:outerShdw>` / `<a:reflection>` → effects;
      `<p:cNvPr descr>` → alt.
- [x] Tests: pick-sections routing, drop-shadow section commit/toggle,
      effects-renderer units, element-renderer shadow integration.

## PR 2 — Image-only adjustments (Recolor · Brightness/Contrast)

- [ ] Model: `image.recolor`, `image.brightness`, `image.contrast`.
- [ ] Renderer: duotone composite + `ctx.filter` pipeline.
- [ ] Panel: `recolor-section.tsx`; extend image Adjustments with
      brightness/contrast sliders alongside transparency.
- [ ] Import: `<a:duotone>`/`<a:clrChange>` → recolor; `<a:lum>` →
      brightness/contrast.
- [ ] Tests.

## Review / smoke

- [ ] `pnpm verify:fast` green per commit
- [ ] Code review over branch diff
- [ ] Manual smoke in `pnpm dev`: select shape → Format options →
      add shadow / reflection; image recolor + adjustments.
