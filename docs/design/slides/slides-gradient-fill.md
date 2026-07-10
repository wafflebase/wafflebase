---
title: slides-gradient-fill
target-version: 0.5.0
---

# Slides gradient fill

## Summary

Shapes filled with a linear gradient in PPTX (`<a:gradFill>`) previously
imported with no fill and rendered invisible — `parseShapeFill` handled only
`<a:solidFill>`. This adds a first-class **linear gradient** fill for shapes,
threaded through the model, importer, canvas renderer, and PPTX export. PDF
export inherits it for free (it rasterizes `drawSlide()`).

## Goals / Non-Goals

**Goals**
- Model a linear gradient fill and preserve it on PPTX import → render →
  PPTX export round-trip.
- Keep every existing solid-fill path working unchanged.

**Non-Goals**
- Radial / path gradients (`<a:path>`): parsed as a linear gradient over the
  same stops at the default angle (colors kept; geometry approximated).
- A gradient *editing* UI. The color picker collapses a gradient to a
  representative solid; picking a color replaces the gradient.
- Gradient fills on text boxes, table cells, and slide backgrounds — those
  are parallel solid-only stacks, deferred.

## Proposal Details

### Model (`model/theme.ts`)

```ts
export type GradientStop = { pos: number; color: ThemeColor }; // pos 0..1
export type GradientFill = { kind: 'gradient'; angle: number; stops: GradientStop[] };
export type Fill = ThemeColor | GradientFill;                  // discriminated on `kind`
export function representativeColor(fill: Fill): ThemeColor;    // gradient → first stop
```

`ShapeElement.data.fill` widens from `ThemeColor` to `Fill`. `angle` is in
radians (clockwise from the positive x-axis; `0` = left→right). The
`kind: 'gradient'` discriminator turns every `resolveColor(data.fill)` into a
compile error, so no consumer is silently missed. Freeform shapes share the
field and renderer, so they get gradients for free. Migration (`wrapColor`)
already passes a `kind`-tagged object through unchanged.

### Import (`import/pptx/shape.ts`)

`parseShapeFill` gains a `<a:gradFill>` branch (`parseGradientFill`): stops
from `<a:gsLst><a:gs pos>` (`pos` 1000ths-of-a-percent → `0..1`) via the
existing `parseColorFromContainer`, and `<a:lin ang>` (60000ths-of-a-degree →
radians). A missing `<a:lin>` (common in exported decks) defaults to
top→bottom (90°). A text box (`txBox="1"`) with a gradient collapses to its
representative solid, since `TextElement.data.fill` stays solid-only.

### Render (`view/canvas/`)

`resolveFillStyle(ctx, fill, theme, w, h)` in `render-context.ts` returns a
CSS string for a solid or a `CanvasGradient` for a gradient, laid out across
the element's local `w × h` box along `angle` (the box's corners project onto
`[start, end]`, matching CSS/PowerPoint extent). It replaces the fill-style
sites in `paintFillStroke`, `drawPlaceholderRect`, and the action-button
special renderer. 3D shaded faces (`paintFaces`) collapse a gradient to its
representative solid so per-face lightening/darkening still works.

### PPTX export (`export/pptx/`)

`color.ts` adds `gradFillXml(g)` (inverse of `parseGradientFill`) and
`fillXml(fill)` dispatching solid vs gradient; the shape writer uses
`fillXml`. Verified by the importer-fixture model-equivalence round-trip.

### Frontend

`readShapeFill` returns a representative solid for the `ThemeColor`-typed
picker; the write path is unchanged (setting a solid replaces the gradient).
`representativeColor` and the new types are exported from the package index.

## Risks and Mitigation

- **Type ripple.** Widening `data.fill` is surfaced by the compiler at every
  consumer; each was updated or coerced. The frontend `tsconfig.app.json` is
  not a CI gate (122 pre-existing errors); ESLint + tests are.
- **3D / radial approximation.** Both fall back to a representative solid /
  linear approximation — colors are preserved, only fine geometry differs.
