---
title: slides-background
target-version: 0.6.0
---

# Slides Background (Color / Image / Gradient)

> **Status: shipped.** The full **Background** side panel — solid + gradient
> **Color** (generic `FillPicker`), an **Image** section with opacity,
> **Reset to theme**, and **Apply to all slides** — is implemented, along with
> the model widening, renderer swap, Yorkie migration, and PPTX `<p:bg>`
> gradient round-trip described below. The panel lives at
> `packages/frontend/src/app/slides/background-side-panel.tsx` (state in
> `use-slide-background.ts`). This document is retained as the design record;
> the sections below describe the shipped implementation. Image tile/repeat
> and background-image crop editing remain the only deferred items.

## Summary

Previously the right-side panel exposed a single **"Background Color"** control —
a solid `ThemeColor` picker. Google Slides instead offers a **Background**
control with a solid **Color**, an **Image**, a **Reset to theme**, and an
**apply-to-all** action, and Wafflebase now matches that.

This was **mostly a UI/plumbing task**: the slide background data model, the
Canvas renderer, and Yorkie persistence already supported an image fill, and
every non-UI layer already had a reusable `Fill`-aware
(`ThemeColor | GradientFill`) helper that the old background code path bypassed
in favor of a solid-only sibling. Shape gradient editing shipped in v0.5.x (the
`FillPicker` / `GradientEditor` components and the `resolveFillStyle` /
`fillXml` / `migrateGradientFill` helpers), so gradient backgrounds were a
*reuse-and-wire* job, not greenfield.

The shipped control is renamed to **Background** and restructured into
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

### 1. Model — `fill` widened from `ThemeColor` to `Fill`

`packages/slides/src/model/presentation.ts`

- `Background.fill?: Fill` (L28).
- `resolveBackgroundFill(slide, doc): Fill` (L208-220). The fallback
  `{ kind: 'role', role: 'background' }` stays valid (a `ThemeColor` is a
  subtype of `Fill`).
- `isInheritableFill(fill: Fill)` (L187-198) reads `.kind === 'role'` and has
  an early `if (fill.kind === 'gradient') return false;` guard so a gradient is
  never treated as an inherit sentinel.
- `resolveBackgroundImage` touches only `.image` — unaffected.
- `DEFAULT_BACKGROUND` stays a solid literal (backward compatible).

`packages/slides/src/model/master.ts`

- `MasterBackground.fill: Fill` (L21). `DEFAULT_MASTER` literal (L39) stays
  solid.

`representativeColor(fill: Fill): ThemeColor` (`theme.ts:93-98`) already
collapses a gradient to a solid and is reused wherever background code must
degrade to a single color.

### 2. Renderer — `Fill`-aware paint helper (both sites)

`packages/slides/src/view/canvas/slide-renderer.ts`

- Both background paint sites use
  `ctx.fillStyle = resolveFillStyle(ctx, resolveBackgroundFill(slide, doc), theme, w, h)`
  (L246-249 no-pasteboard path, L268-271 pasteboard path;
  `render-context.ts`, the same helper shapes use). It returns a solid CSS
  string for a `ThemeColor` or a `CanvasGradient` for a gradient, laid across
  the `w × h` box, with a degenerate fallback to
  `resolveColor(representativeColor(fill))`.
- **Nuance:** the no-pasteboard path runs under the identity CTM (the
  `ctx.scale` is applied afterwards) and fills the whole bitmap in **device
  pixels** — so it passes `bitmapW × bitmapH` as `w/h`, matching the filled
  rect. Only the **pasteboard** path, which paints after `ctx.scale` in logical
  coords, passes the logical slide size (`SLIDE_WIDTH × slideH`). A gradient
  laid across the logical size in the no-pasteboard branch would only line up
  when `bitmapW === SLIDE_WIDTH`, silently breaking thumbnails, PDF export, and
  no-pasteboard presentation/mobile.
- The image fill (`pickBackgroundImage` → `drawImage`) paints over the
  color/gradient fill.

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

- `migrateBackground` (L136) uses the same ternary as `migrateElement`:
  `out.fill = bg.fill?.kind === 'gradient' ? migrateGradientFill(bg.fill) : wrapColor(bg.fill)`.
  `migrateGradientFill` (L180) is reused verbatim.

- **Write path is unchanged.** `updateSlideBackground` (`yorkie-slides-store.ts:874-879`)
  does `s.background = clone(bg)`, and the master/layout writers (L1020-1021,
  L1091-1093) also `clone` — all gradient-agnostic. Gradients ride through
  because the whole `background` object is cloned, exactly like shape fills.

### 4. UI — a right-side **panel**, consistent with Theme / Motion / Format

Background is a **right-side panel** (`background-side-panel.tsx`), not a
toolbar dropdown — so it matches the Theme / Motion / Format panels rather
than being the odd one out. It participates in the single `RightPanel`
union (`slides-detail.tsx`, `"theme" | "format" | "motion" | "background" |
null`), so it is mutually exclusive with the others and toggles from a
toolbar `Toggle` button (`global-controls.tsx`, `IconBackground`) exactly
like them. Desktop renders the `variant="drawer"` `w-72` aside; mobile
renders `variant="sheet"` inside the shared bottom `Sheet`.

**Panel layout** (sections, like the Format panel):

```text
┌ Background                 × ┐
│ Color                        │
│   [ Solid | Gradient ]       │  <FillPicker> (existing, generic)
│   [ swatch palette / stops ] │
│ Image                        │
│   [ Choose / Replace image… ]│  → image-upload URL pipeline
│   Opacity ▓▓▓░ 80%           │  image.opacity slider (commit on release)
│   [ Remove image ]           │
│ ───────────────────────────  │
│ [ Reset to theme ]           │  clear fill + image
│ [ Apply to all slides ]      │  write to master background
└──────────────────────────────┘
```

**Reused as-is:** `FillPicker` (`fill-picker/index.tsx`, Solid|Gradient) and
the `useSlideBackground` hook (below). The panel owns one `useSlideBackground`
instance (no `onCommit` auto-close — the panel stays open like the others),
subscribes to `store.onChange` + `editor.onCurrentSlideChange` to refresh on
slide switches, and flushes any in-progress gradient draft on unmount via a
`bgRef`-backed cleanup (covers drawer ×, panel switch, and mobile Sheet close
uniformly).

**`useSlideBackground`** (`use-slide-background.ts`) owns all read/write
semantics: `backgroundFill: Fill`, `backgroundImage`, `gradientDraft`;
`onChangeSolid`/`onChangeGradient` (draft + commit-on-flush, pattern lifted
from `shape-controls.tsx`) → `updateSlideBackground(slideId, { fill })`;
`onChooseImage(src)` → `{ image: { src } }`; `onChangeImageOpacity`;
`onResetToTheme` → `{}`; `onApplyToAll` → `updateMaster(doc.meta.masterId,
{ background: { fill, ...(image ? { image } : {}) } })`.

**Wiring sites:** the desktop dropdown and the bespoke mobile
`SlideBackgroundSheet` were **removed**; the toolbar `Toggle`
(`global-controls.tsx`) drives `rightPanel`, and both surfaces mount the one
`BackgroundSidePanel`.

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

### 6. PPTX import / export — gradient helpers reused

`packages/slides/src/import/pptx/slide.ts` — `parseSlideBackground` handles
`blipFill` (image), `gradFill` (L193-197, calling `parseGradientFill(grad,
clrMap)` from `shape.ts`), and `solidFill` (color).

`packages/slides/src/export/pptx/slide.ts` — `backgroundToXml` (L83) calls
`fillXml(fill)` (L70-72, from `export/pptx/color.ts`), which emits `gradFill`
for gradients else solid. Image `<a:blipFill>` export is unchanged.

## Phasing (shipped)

**Phase 1 — core** ✅

1. Model widening (`Background.fill`/`MasterBackground.fill` → `Fill`,
   `resolveBackgroundFill`, `isInheritableFill` guard).
2. Renderer `resolveColor` → `resolveFillStyle` swap (both sites + PDF).
3. Yorkie `migrateBackground` gradient branch + type widen.
4. Panel restructure: label → **Background**, Color=`FillPicker`
   (solid+gradient), Image upload section, **Reset to theme**; desktop +
   mobile. `use-slide-background.ts` widened with gradient draft/commit.

**Phase 2 — extension** ✅

5. **Apply to all slides** (master background write).
6. Image **opacity** slider.
7. PPTX `<p:bg>` gradient import + export.

## Risks and Mitigation

| Risk | Mitigation |
| --- | --- |
| No-pasteboard renderer path fills the DPR-scaled bitmap under the identity CTM, so a gradient axis could map to the wrong box | Pass the **bitmap** size (`bitmapW × bitmapH`) as `w/h` to `resolveFillStyle` in the no-pasteboard branch (device pixels, matching the filled rect); the pasteboard branch passes logical `SLIDE_WIDTH × slideH` |
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
