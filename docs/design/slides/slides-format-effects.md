---
title: slides-format-effects
target-version: 0.4.7
---

# Slides Format options — per-type editable properties

## Summary

The slides Format options panel (right side) currently exposes only
`Size & Position` for shapes, `Text fitting` for text, and
`Adjustments (transparency)` + `Alt text` for images. This design
brings it to **Google Slides parity**, routed by **element type**:
each type surfaces the effect sections GS shows for it.

Fill colour and Border stay in the contextual toolbar
(`shape-controls.tsx`) — Google Slides keeps them toolbar-only and so
do we. The panel grows the effect sections GS puts there: Drop shadow,
Reflection, Recolor, Adjustments (brightness/contrast), Alt text.

PPTX is **import-only** in this package (no exporter exists), so
"round-trip" means parsing the OOXML effect elements on import.

## Per-type menu

| Element type | Sections (in order) |
|---|---|
| shape | Size & rotation · Position · Drop shadow · Reflection · Alt text |
| image | Size & rotation · Position · Recolor · Adjustments · Drop shadow · Reflection · Alt text |
| text | Size & rotation · Position · Text fitting · Drop shadow · Reflection · Alt text |
| connector | Size & rotation · Position |
| table | Size & rotation · Position · Alt text |
| group | Size & rotation · Position |
| mixed | Position |

Drop shadow / reflection are routed to single-silhouette leaves only
(shape / image / text). Tables and groups are multi-draw, so a per-cell
/ per-child `ctx.shadow*` would shadow every border / child; they are
excluded from those sections in v1.

## Data model

`packages/slides/src/model/element.ts`:

```ts
export type DropShadow = {
  color: ThemeColor | string;  // <a:outerShdw><a:srgbClr>
  opacity: number;             // 0..1  ↔ <a:alpha>
  angle: number;               // radians ↔ <a:outerShdw dir> (60000ths)
  distance: number;            // px ↔ dist (EMU)
  blur: number;                // px ↔ blurRad (EMU)
};

export type Reflection = {
  opacity: number;   // 0..1 start alpha ↔ <a:reflection stA>
  distance: number;  // px ↔ dist
  size: number;      // 0..1 fade length ↔ endPos
};

export type Effects = { shadow?: DropShadow; reflection?: Reflection };
```

`effects?: Effects` is added to `ShapeElement.data`, `ImageElement.data`,
`TextElement.data`, `TableElement.data`, `GroupElement.data`. `alt?: string`
is added to the `data` of shape / text / table (image already had
`data.alt`) so every object type the panel routes Alt text to carries it.

All fields optional ⇒ no migration; absent ⇒ no effect.

Image-only (PR 2): `image.recolor?: 'none' | 'grayscale' | 'sepia'`
(preset presets via `ctx.filter`; theme-tinted duotone deferred),
`image.brightness?: number` (-1..1), `image.contrast?: number` (-1..1).

## Rendering

`element-renderer.ts` wraps the per-type paint:

- **Shadow**: set `ctx.shadowColor/Blur/OffsetX/OffsetY` from
  `effects.shadow` (offset = distance·cos/sin angle) before the
  geometry pass, clear before the text pass so glyphs aren't
  double-shadowed.
- **Reflection**: after the element paints, draw a vertically-mirrored
  copy below it with a top-down alpha gradient mask (offscreen
  canvas), `globalAlpha = reflection.opacity`.
- **Recolor / brightness / contrast** (PR 2): `ctx.filter` +
  duotone composite in `image-renderer.ts`.

## Panel

`pick-sections.ts` returns the section list per `selectionType`. New
sections: `drop-shadow-section.tsx`, `reflection-section.tsx`,
`recolor-section.tsx` (PR 2); `alt-text-section.tsx` extended to all
object types; image Adjustments extended with brightness/contrast.

Commit pattern mirrors existing sections: read current
`el.data.effects`, compute merged object, write via
`store.updateElementData(slideId, id, { effects })` inside
`store.batch`. Multi-select shows common value or blank.

## Rollout

Two PRs on branch `slides-format-effects`:

1. Panel IA + object effects (shadow, reflection, alt text) across
   shape/image/text/table/group + PPTX import + tests.
2. Image-only recolor + brightness/contrast + import + tests.

Each commit keeps `pnpm verify:fast` green; code review over the
branch diff; manual smoke in `pnpm dev`.
