---
title: slides-gradient-editing
target-version: 0.6.0
---

<!-- Append this document link to docs/design/README.md after merging. -->

# Slides gradient editing

## Summary

[`slides-gradient-fill.md`](./slides-gradient-fill.md) shipped a first-class
**linear** gradient fill for shapes: PPTX `<a:gradFill>` imports, renders, and
round-trips through export. But it shipped with a gradient *editing UI* as an
explicit non-goal — the fill color picker collapses any gradient to a
representative solid, so an imported gradient can be viewed but never adjusted,
and a gradient can never be authored from scratch.

This spec adds the editing UI: the toolbar fill dropdown gains a
`Solid | Gradient` toggle, and the Gradient mode surfaces a PowerPoint-style
**stops-bar** (add / drag / delete stops, each with its own color + position +
transparency) plus direction controls. It also extends the model, renderer,
importer, and exporter from linear-only to **linear + radial**, so radial
gradients — today collapsed to their first stop on import — survive the
round-trip and become editable.

Google Slides is not a reference here: it has no gradient fill editor at all.
The design follows **PowerPoint / Keynote**, whose stops-bar idiom is the de
facto standard.

## Goals / Non-Goals

**Goals**

- Extend the toolbar fill dropdown with a `Solid | Gradient` segmented toggle
  and an inline `GradientEditor` (stops-bar + direction).
- Author a gradient from scratch and edit every imported gradient's stops,
  positions, per-stop color/transparency, and direction.
- Reuse the existing `ThemedColorPicker` for per-stop color so stops can be
  **theme role colors** (theme-following gradients) or srgb + alpha.
- Widen the model / renderer / importer / exporter from linear-only to
  **linear + radial**, preserving radial gradients through the PPTX round-trip.
- Apply gradient edits to shapes **and** freeform shapes (shared field +
  renderer), with multi-select writes collapsed into a single `store.batch`.

**Non-Goals**

- **Path / shape gradients** (`<a:path path="shape">`) beyond `circle`.
  Still collapsed to their representative solid on import, as today.
- **On-canvas gradient handles** (drag the axis / center directly on the
  shape). The editor is inline in the fill popover only; radial center is
  chosen from 5 presets, not dragged. The model stores `center` as a free
  `{x, y}` so a later drag UI needs no migration.
- **Preset gradient swatches** (PowerPoint's "Preset gradients" row). Gradient
  mode seeds a 2-stop default from the current solid; a curated preset row is
  a follow-up.
- **Gradient fills on text boxes, table cells, and slide backgrounds.** Those
  remain solid-only parallel stacks, as in the gradient-fill spec.
- **Angle dial widget.** Linear direction is 8 presets + a numeric degree
  input, not a circular dial.

## Proposal Details

### Model (`model/theme.ts`)

`GradientFill` gains a `type` discriminator and an optional radial `center`:

```ts
export type GradientStop = { pos: number; color: ThemeColor }; // unchanged

export type GradientFill = {
  kind: 'gradient';
  type: 'linear' | 'radial';           // NEW
  angle: number;                        // linear only, radians (cw from +x)
  center?: { x: number; y: number };    // NEW: radial only, 0..1, default {0.5, 0.5}
  stops: GradientStop[];
};

export type Fill = ThemeColor | GradientFill; // unchanged
```

- `type` is **required**, not optional — every gradient carries an explicit
  kind so `resolveFillStyle` / `gradFillXml` switch exhaustively.
- `migrate.ts` backfills existing stored gradients (all linear, from the v1
  importer) with `type: 'linear'` — a one-line map. Absence of `center` means
  `{ x: 0.5, y: 0.5 }` (from-center), applied at read time, not migrated.
- `representativeColor(fill)` (first stop) is unchanged and still powers the
  Gradient→Solid collapse.

### Editing UI (`packages/frontend/src/app/slides/`)

#### Fill popover shell — `FillPicker`

A new `FillPicker` wraps the current `ThemedColorPicker` in the shape fill
dropdown. A segmented toggle sits at the top:

```
┌ Fill ───────────────────┐
│  [ Solid ] [ Gradient ] │  ← segmented toggle
├─────────────────────────┤
│  Solid    → ThemedColorPicker (unchanged)
│  Gradient → GradientEditor
└─────────────────────────┘
```

- Opening reflects the current fill: `kind === 'gradient'` selects Gradient,
  otherwise Solid.
- **Solid → Gradient**: seed `[{ pos: 0, color: current }, { pos: 1, color:
  lighten(current) }]`, `type: 'linear'`, `angle: π/2` (top→bottom, the PPT
  default). If the current fill has no color (none), seed from the theme's
  primary role.
- **Gradient → Solid**: collapse to `representativeColor` and emit a solid —
  matches the existing color-pick-replaces-gradient behavior.

#### `GradientEditor`

```
┌ Gradient ────────────────────────────┐
│ ▓▓▓▓▒▒▒▒░░░░  preview (live gradient) │
│ ●──────────●───────────────●          │  stops-bar
│                                       │
│ Type:  [ Linear ] [ Radial ]          │
│  Linear → Direction: ↖↑↗←•→↙↓↘  [45]° │
│  Radial → Direction: ⌜ ⌝ • ⌞ ⌟        │
│                                       │
│ Selected stop                         │
│   Color: [swatch ▾]   Position: [50]% │
│   [ Delete stop ]                     │
└───────────────────────────────────────┘
```

**stops-bar interaction**

- A horizontal track paints the live gradient (linear preview even in radial
  mode — the bar shows the stop blend, direction is conveyed separately).
- **Add**: click empty track → insert a stop at that `pos`, color interpolated
  from the two neighbors.
- **Move**: drag a marker → update `pos` (clamped 0..1). The selected marker is
  highlighted.
- **Recolor**: click a marker → nested popover with the existing
  `ThemedColorPicker` (`allowAlpha` on). Role picks yield theme-following
  stops; srgb + transparency map to OOXML per-stop color/alpha. Nested-popover
  focus/close is handled with the existing `useMenuCloseHandlers` pattern.
- **Delete**: Delete-stop button / drag-off-track / Backspace. **Minimum 2
  stops** enforced (delete disabled at 2).

**Direction**

- **Linear**: 8 preset direction buttons + a numeric degree input. UI works in
  degrees; the model stores `angle` in radians. Presets set the common 45°
  increments; the numeric field allows any angle.
- **Radial**: 5 preset buttons (center + 4 corners) writing `center` as
  `{ x, y }` in 0..1 — center `{0.5, 0.5}`, corners `{0,0} … {1,1}`. These map
  1:1 to OOXML `<a:fillToRect>`.

**Selected-stop row**: color swatch (opens the nested picker) + a `Position`
numeric input (0–100 %, ↔ `pos` 0..1), plus the delete button.

**Commit timing**: marker drags and the transparency slider update a local
draft and commit once on pointer-up (one undo unit per gesture), matching the
Format-panel / drop-shadow slider convention. Discrete picks (add stop, recolor
swatch, direction preset, degree/position input blur) commit immediately via
`store.batch`.

#### Wiring — `shape-controls.tsx`, `themed-color-picker-helpers.ts`

- Keep `readShapeFill` (representative solid, for the Solid tab). Add
  `readShapeGradient(el): GradientFill | undefined` for the Gradient tab.
- The write path widens the existing shape-fill store op to accept `Fill`
  (solid or gradient). Multi-select applies the same `Fill` to every selected
  shape in a single `store.batch` — Format-panel parity.
- Targets: `shape` and `freeform` (they share `data.fill` + the renderer, so
  freeform gets gradient editing for free). Text boxes, table cells, and
  backgrounds keep their solid-only pickers.

### Render (`view/canvas/render-context.ts`)

`resolveFillStyle` gains a radial branch; the linear branch is unchanged:

```ts
if (fill.type === 'radial') {
  const cx = (fill.center?.x ?? 0.5) * w;
  const cy = (fill.center?.y ?? 0.5) * h;
  // Radius reaches the farthest corner so the last stop covers the box,
  // matching PowerPoint's circle-path extent.
  const r = Math.max(
    Math.hypot(cx, cy), Math.hypot(w - cx, cy),
    Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy),
  );
  if (stops.length < 2 || r === 0) return resolveColor(representativeColor(fill), theme);
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const s of stops) grad.addColorStop(clamp01(s.pos), resolveColor(s.color, theme));
  return grad;
}
```

The existing degenerate-case fallback (fewer than 2 stops → representative
solid) and the `paintFaces` 3D collapse are unchanged.

### Import (`import/pptx/shape.ts`)

`parseGradientFill` currently collapses any `<a:path>` gradient to its first
stop. Upgrade the `circle` case to preserve it:

- `<a:path path="circle">` → `type: 'radial'`; read `<a:fillToRect l/t/r/b>`
  (1000ths-of-a-percent insets) and derive `center` (e.g. `x = l/(l+r)`,
  `y = t/(t+b)`, defaulting to `{0.5, 0.5}` when absent).
- `<a:path path="rect">` and `path="shape"` stay collapsed to the
  representative solid (still a documented non-goal).
- Linear (`<a:lin ang>` / absent → 90°) is unchanged except it now sets
  `type: 'linear'` explicitly.

### PPTX export (`export/pptx/color.ts`)

`gradFillXml` switches on `type`:

- `linear` → `<a:lin ang="...">` (unchanged).
- `radial` → `<a:path path="circle"><a:fillToRect .../></a:path>`, inverting the
  import `center` → insets mapping.

Verified by the existing importer-fixture model-equivalence round-trip
(extended with a radial fixture).

## Risks and Mitigation

- **Required `type` migration.** Making `type` required means old stored
  gradients (linear, no `type`) must be backfilled. Mitigation: a one-line
  `migrate.ts` map sets `type: 'linear'`; covered by a migration unit test.
- **Nested popover (stop picker inside fill popover).** Focus and outside-click
  handling can misfire. Mitigation: reuse the established
  `useMenuCloseHandlers` / `markSwatchClicked` pattern already used by the fill
  dropdown; a browser smoke scenario opens the stop picker and picks a color.
- **Radial extent approximation.** OOXML `<a:fillToRect>` defines a focus
  rectangle, not a plain radius; the renderer approximates with a
  center-to-farthest-corner radius. Mitigation: colors and center are
  preserved; only fine falloff geometry differs, matching the linear-extent
  approximation already accepted in the gradient-fill spec.
- **Frontend type ripple.** Widening the shape-fill write op to `Fill` surfaces
  at each call site via the compiler. The frontend `tsconfig.app.json` is not a
  CI gate (pre-existing errors); ESLint + tests are, so new call sites are
  covered there.
- **Stops-bar on a narrow popover.** The inline editor must fit the ~208px fill
  popover width. Mitigation: the stops-bar is full-width within the popover;
  direction presets use a compact 3×3 / 5-button grid; the nested color picker
  reuses the existing 208px layout.
