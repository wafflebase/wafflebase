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
- [x] Import: PPTX `<a:outerShdw>` / `<a:reflection>` → effects;
      `<p:cNvPr descr>` → alt. (slice on `slides-format-effects-import`)
  - New `src/import/pptx/effects.ts`: `parseEffects(spPr, scale, clrMap)`
    (outerShdw → DropShadow via `rotEmuToRad`/`emuToStrokePx`/
    `parseColorFromContainer`, alpha → `opacity`; reflection → Reflection),
    `readAltText(el)` (nv*Pr → cNvPr@descr), `parseImageAdjustments(blip)`.
  - Wire: `parseChild`'s `sp` branch attaches effects+alt to the first
    emitted element (the silhouette — avoids double-shadow on the
    `[image,text]` blip-fill-with-caption case); `parsePic` (host spPr/nv);
    `parseTable` (graphicFrame, alt only). Group effects intentionally not
    imported (renderer paints effects on leaves only).
  - Drop the now-stale `report.shadowsDropped` increment (shadows import).
- [x] Tests: pick-sections routing, drop-shadow + reflection section
      commit/toggle, effects-renderer units (shadow + reflection),
      element-renderer shadow integration.

## PR 2 — Image-only adjustments (Recolor · Brightness/Contrast)

- [x] Model: `image.recolor` (`none`/`grayscale`/`sepia`),
      `image.brightness`, `image.contrast` (`-1..1`).
- [x] Renderer: `imageFilter()` → composed `ctx.filter` (grayscale/sepia
      + brightness/contrast). Duotone (theme-tinted) deferred — needs
      offscreen color compositing.
- [x] Panel: `recolor-section.tsx` (None/Grayscale/Sepia presets);
      image Adjustments extended with Brightness + Contrast sliders.
- [x] Import: `<a:duotone>`/`<a:clrChange>` → recolor; `<a:lum>` →
      brightness/contrast. (slice with shadow/reflection import)
  - `parseImageAdjustments` in `effects.ts`: `<a:grayscl>` → grayscale,
    `<a:duotone>` → sepia (warm srgbClr accent) else grayscale, `<a:lum
    bright/contrast>` → brightness/contrast (/100000). `<a:clrChange>`
    intentionally unmapped (arbitrary swap, no preset analog).
  - Wire into `parseBlipFill` (adjustments live in `<a:blip>`, so both
    `<p:pic>` and shape-`blipFill` images pick them up).
- [x] Tests: imageFilter units, recolor section, adjustments patch
      commits, pick-sections image routing.

## Review / smoke

- [x] `pnpm verify:fast` green per commit (import slice)
- [x] Code review over branch diff (`/code-review --effort high`); 3
      findings fixed — CLI `shadowsDropped` compile break, background
      adjustment leak (`toBackgroundImage`), dup shadow on `[image,text]`.
      See `*-lessons.md`. Verified `slides build` + CLI `tsc` clean.
- [x] Manual smoke: import a PPTX with shape drop shadow / reflection,
      a picture recolor + brightness/contrast, and a `descr` alt; confirm
      they render and appear in the Format panel. (Earlier panel-edit smoke
      already covered; this slice only adds the import path.) Shipped via
      PR #396 (merged to `main`).
