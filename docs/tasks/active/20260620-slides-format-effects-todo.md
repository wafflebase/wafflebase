# Slides Format options — per-type effects

Expose Google-Slides-parity editable properties in the slides Format
options panel, routed by element type. Fill/Border stay in the toolbar
(GS parity); the panel gains effect sections.

Design doc: `docs/design/slides/slides-format-effects.md`

## PR 1 — Panel IA + object effects (Shadow · Reflection · Alt text)

- [x] Model: `DropShadow`, `Reflection`, `Effects` types; `effects?` on
      shape/image/text/table/group `data`; `alt?` on shape/text/table `data`.
- [x] Renderer: `applyShadow`/`clearShadow` + `paintReflection`
      (offscreen mirror, graceful no-op without a 2D ctx) around
      shape/image/text paint in `element-renderer.ts`.
- [x] Panel: `pick-sections.ts` routing → `drop-shadow`, `reflection`,
      `alt-text` (alt extended to shape/text/table).
- [x] Sections: `drop-shadow-section.tsx`, `reflection-section.tsx`;
      `alt-text-section.tsx` generalized to all object types.
- [ ] Import: PPTX `<a:outerShdw>` / `<a:reflection>` → effects;
      `<p:cNvPr descr>` → alt. (follow-up slice)
- [x] Tests: pick-sections routing, drop-shadow + reflection section
      commit/toggle, effects-renderer units (shadow + reflection),
      element-renderer shadow integration.

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
