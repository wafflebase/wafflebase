---
title: slides-background
target-version: 0.6.0
---

# Slides Background (Color / Image / Gradient)

## Summary

Today the right-side panel exposes a single **"Background Color"** control —
a solid `ThemeColor` picker. Google Slides instead offers a **Background**
dialog with a solid **Color**, an **Image**, a **Reset to theme**, and an
**Add to theme / apply-to-all** action.

The key finding is that this is **mostly a UI/plumbing task**: the slide
background data model, the Canvas renderer, and Yorkie persistence already
support an image fill, and every non-UI layer already has a reusable
`Fill`-aware (`ThemeColor | GradientFill`) helper that the background code
path deliberately bypasses in favor of a solid-only sibling. Shape gradient
editing shipped in v0.5.x (the `FillPicker` / `GradientEditor` components and
the `resolveFillStyle` / `fillXml` / `migrateGradientFill` helpers), so
gradient backgrounds are now a *reuse-and-wire* job, not greenfield.

This design renames the control to **Background** and restructures it into
**Color / Image** sections, wires the existing generic `FillPicker` (solid +
gradient in one component), reuses the existing image-upload URL pipeline for
image backgrounds, and adds **Reset to theme** and **Apply to all slides**.

## Goals / Non-Goals

**Goals**

- Rename the panel control `Background Color` → `Background`.
- **Color** section supporting **solid *and* linear/radial gradient** fills,
  by dropping in the existing generic `FillPicker` / `GradientEditor`.
- **Image** section: upload an image and set it as the slide background,
  reusing the `insert-image.ts` / `image-upload.ts` remote-URL pipeline; an
  **opacity** slider (`image.opacity`, already in the model).
- **Reset to theme** — clear the slide's `fill`/`image` so it inherits from
  layout → master → theme.
- **Apply to all slides** — write the background to the slide's **master**
  (`updateMaster`), so all slides sharing that master inherit it.
- Desktop (`global-controls.tsx`) and Mobile (`mobile-toolbar.tsx` bottom
  sheet) parity.
- Best-effort PPTX `<p:bg>` gradient import/export (round-trip parity with the
  existing solid + image support).

**Non-Goals**

- **Image tile / repeat modes** — the renderer stretches the image to the
  slide box (1920×1080); tiling stays a future item.
- **Background image crop editing** — needs a pasteboard crop-session UI
  (distinct from the element crop session); deferred.
- **New rendering or model primitives** — every capability reuses an existing
  `Fill`-aware helper; no new Canvas paint code or CRDT schema is introduced
  beyond widening `fill` from `ThemeColor` to `Fill`.

## Proposal Details

### 1. Model — widen `fill` from `ThemeColor` to `Fill`

`packages/slides/src/model/presentation.ts`

- `Background.fill?: ThemeColor` → `Background.fill?: Fill` (L28).
- `resolveBackgroundFill(slide, doc): ThemeColor` → return `Fill` (L207-219).
  The fallback `{ kind: 'role', role: 'background' }` stays valid (a
  `ThemeColor` is a subtype of `Fill`).
- `isInheritableFill(fill: ThemeColor)` (L187-197) reads `.kind === 'role'`;
  add an early `if (fill.kind === 'gradient') return false;` guard so a
  gradient is never treated as an inherit sentinel.
- `resolveBackgroundImage` (L225-234) touches only `.image` — unaffected.
- `DEFAULT_BACKGROUND` (L174-176) stays a solid literal (backward compatible).

`packages/slides/src/model/master.ts`

- `MasterBackground.fill: ThemeColor` → `Fill` (L21). `DEFAULT_MASTER`
  literal (L39) stays solid.

`representativeColor(fill: Fill): ThemeColor` (`theme.ts:93-98`) already
collapses a gradient to a solid and is reused wherever background code must
degrade to a single color.

### 2. Renderer — swap the solid-only paint for the `Fill`-aware helper

`packages/slides/src/view/canvas/slide-renderer.ts`

- Both background paint sites currently do
  `ctx.fillStyle = resolveColor(resolveBackgroundFill(slide, doc), theme)`
  (L184 no-pasteboard path, L204 pasteboard path). `resolveColor`
  (`theme.ts:100-118`) returns only a solid string.
- Replace with
  `ctx.fillStyle = resolveFillStyle(ctx, resolveBackgroundFill(slide, doc), theme, w, h)`
  (`render-context.ts:20-48`, the same helper shapes use at
  `shape-renderer.ts:400/418`). It returns a solid CSS string for a
  `ThemeColor` or a `CanvasGradient` for a gradient, laid across the `w × h`
  box, with a degenerate fallback to `resolveColor(representativeColor(fill))`.
- **Nuance:** the no-pasteboard path (L184) fills the whole bitmap
  (`bitmapW × bitmapH`). Pass the **logical slide size** (`SLIDE_WIDTH ×
  slideH`) as `w/h` so the gradient axis maps to the slide, not the DPR-scaled
  bitmap.
- The image fill (L214-217, `pickBackgroundImage` → `drawImage`) is unchanged;
  it already paints over the color/gradient fill.

`packages/slides/src/export/pdf.ts` — PDF export rasterizes `drawSlide`, so
image backgrounds already round-trip (L264/L330 reference
`resolveBackgroundImage`). Confirm the background **fill** paint path used by
PDF also routes through `resolveFillStyle`; if PDF paints fill separately, add
the same swap there.

### 3. Yorkie persistence — one migration branch, no write changes

`packages/frontend/src/types/slides-document.ts`

- `YorkieSlide.background.fill?: ThemeColor` → `Fill` (L91-92). Pre-v0.5
  legacy string migration (L84-89) is unaffected.

`packages/slides/src/model/migrate.ts`

- `migrateBackground` (L136-146) currently does
  `out.fill = wrapColor(bg.fill)` (solid only). Change to the exact ternary
  already used by `migrateElement` (L148-161):
  `bg.fill?.kind === 'gradient' ? migrateGradientFill(bg.fill) : wrapColor(bg.fill)`.
  `migrateGradientFill` (L173-181) is reused verbatim.

- **Write path is unchanged.** `updateSlideBackground` (`yorkie-slides-store.ts:874-879`)
  does `s.background = clone(bg)`, and the master/layout writers (L1020-1021,
  L1091-1093) also `clone` — all gradient-agnostic. Gradients ride through
  because the whole `background` object is cloned, exactly like shape fills.

### 4. UI — restructure the panel, reuse `FillPicker`

**Panel layout** (desktop popover + mobile bottom sheet):

```
┌ Background ────────────────┐
│ [ Color ] [ Image ]         │  segmented toggle
│ ──────────────────────────  │
│ (Color)  <FillPicker>        │  Solid | Gradient tabs (existing)
│ (Image)  [ Choose image… ]   │  → image-upload URL pipeline
│          Opacity ▓▓▓░ 80%    │  image.opacity slider
│ ──────────────────────────  │
│ ↺ Reset to theme            │  clear fill + image
│ ☑ Apply to all slides       │  write to master background
└─────────────────────────────┘
```

**Components to reuse (drop-in, already generic — no shape coupling):**

- `FillPicker` (`fill-picker/index.tsx:32`) — Solid | Gradient toggle, props
  `{ fill: Fill | undefined; onChangeSolid; onChangeGradient; onClear }`.
- `GradientEditor` (`fill-picker/gradient-editor.tsx:56`) — stops-bar.

**The one non-trivial wiring** — `packages/frontend/src/app/slides/use-slide-background.ts`
(currently hard-codes `{ fill: color }` at L44-56):

- Widen `backgroundFill` return type `ThemeColor | undefined` → `Fill | undefined`.
- Add `onChangeSolid` / `onChangeGradient` writing
  `updateSlideBackground(slideId, { fill })` and an `onClearFill`.
- Add `onChangeImage(src)` writing `updateSlideBackground(slideId, { image: { src } })`
  and `onChangeOpacity`.
- Add `onResetToTheme()` → `updateSlideBackground(slideId, {})`.
- Add `onApplyToAll()` → `updateMaster(masterId, { background: { ... } })` for
  the current slide's master.
- Gradient needs a **draft/commit debounce** (drag stops without spamming
  CRDT ops then commit on release); lift the pattern almost verbatim from
  `shape-controls.tsx:62-164` (`persistGradient` debounce → commit).

**Wiring sites:**

- Desktop: `global-controls.tsx:220-223` — replace `<ThemedColorPicker>` with
  the new Background popover (Color=`FillPicker`, Image section).
- Mobile: `mobile-toolbar.tsx` `SlideBackgroundSheet` (L654+) — same content in
  the bottom sheet.

**Store ops** (all already exist — `store.ts`):

- `updateSlideBackground(slideId, bg: Background)` (L75) — full replace, already
  accepts `{ fill } | { image } | {}`.
- `updateMaster(masterId, { background })` (L26-27) for **Apply to all**;
  `image: null` clears.

### 5. Image background — reuse the existing upload pipeline

- Upload via `image-upload.ts` (`upload(file) → { id, url }`, `resolveImageUrl`
  makes an absolute URL). Persist `background.image.src = url` — the same
  remote-URL storage that image *elements* use (`insert-image.ts:61-76`). No
  blob/data-URI in the CRDT.
- Renderer already stretches it (`drawImage` at `slide-renderer.ts:214-217`).
- Opacity via the existing `image.opacity` field.

### 6. PPTX import / export — reuse gradient helpers

`packages/slides/src/import/pptx/slide.ts` — `parseSlideBackground` (L172-199)
handles `blipFill` (L183) + `solidFill` (L192-195). Add a `gradFill` branch
calling the existing `parseGradientFill(grad, clrMap)` (`shape.ts:940-968`).

`packages/slides/src/export/pptx/slide.ts` — `backgroundToXml` (L79-86) calls
`solidFillXml(fill)` (L85). Swap to the existing `fillXml(fill)`
(`export/pptx/color.ts:67-70`), which emits `gradFillXml` for gradients else
solid. Image `<a:blipFill>` export is unchanged.

## Phasing

**Phase 1 — core (single PR)**

1. Model widening (`Background.fill`/`MasterBackground.fill` → `Fill`,
   `resolveBackgroundFill`, `isInheritableFill` guard).
2. Renderer `resolveColor` → `resolveFillStyle` swap (both sites + PDF).
3. Yorkie `migrateBackground` gradient branch + type widen.
4. Panel restructure: label → **Background**, Color=`FillPicker`
   (solid+gradient), Image upload section, **Reset to theme**; desktop +
   mobile. `use-slide-background.ts` widened with gradient draft/commit.

**Phase 2 — extension (single PR)**

5. **Apply to all slides** (master background write).
6. Image **opacity** slider.
7. PPTX `<p:bg>` gradient import + export.

## Risks and Mitigation

| Risk | Mitigation |
| --- | --- |
| No-pasteboard renderer path fills the DPR-scaled bitmap, so a gradient axis could map to the wrong box | Pass logical `SLIDE_WIDTH × slideH` as `w/h` to `resolveFillStyle`, not bitmap size |
| Widening `Background.fill` to `Fill` breaks `isInheritableFill` type-narrowing | Add `kind === 'gradient'` early-return guard; a gradient is never inheritable |
| Legacy pre-v0.5 string / solid backgrounds must keep loading | `migrateBackground` ternary preserves the `wrapColor` path for non-gradient; only adds the gradient branch |
| Gradient stop dragging spams CRDT ops | Draft/commit debounce lifted from `shape-controls.tsx:62-164` |
| Apply-to-all overwrites per-slide overrides unexpectedly | It writes the **master** only; slides with their own `background` keep it via the existing inheritance rules — documented in the panel copy |
| PPTX `gradFill` on `<p:bg>` variety (paths, tiling) not fully covered | Best-effort: reuse `parseGradientFill`; unsupported sub-variants degrade to representative solid via `representativeColor` |

## Testing

- **Unit** (`packages/slides`): `migrateBackground` round-trips solid, legacy
  string, gradient, and image; `resolveBackgroundFill` returns gradient and
  falls through inheritance; `resolveFillStyle` on a slide-sized box.
- **Render**: golden/visual check that a gradient background paints across the
  slide (not the bitmap) and an image background stretches with opacity.
- **PPTX**: import a deck with a `<p:bg><a:gradFill>` and re-export; assert the
  model-equivalence round-trip (reuses the importer-fixture harness).
- **Frontend**: `use-slide-background` writes `{ fill }` / `{ image }` / `{}`
  and the master path for apply-to-all; desktop + mobile smoke.
