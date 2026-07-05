# Slides — per-deck slide size (fix 4:3 import distortion)

## Problem

Imported non-16:9 PPTX decks are stretched. The Slides model hardcodes a
logical canvas of `SLIDE_WIDTH=1920 × SLIDE_HEIGHT=1080` (16:9). The PPTX
importer force-fits any deck into it with **per-axis** scaling
(`emuScale` → `{ sx: 1920/cx, sy: 1080/cy }`), so a 4:3 deck
(`<p:sldSz cx=9144000 cy=6858000>` = 10"×7.5") gets stretched 1.333×
horizontally — circles become ellipses. The distortion is baked into
stored coordinates at import time.

Reproduced on "Yorkie branding_v1.pptx" (4:3), shared doc
`47b8f367-bb16-4756-88bc-4dee1df9d6eb`.

## Approach

Keep `SLIDE_WIDTH = 1920` as the **fixed canonical logical width**; make
the **height per-deck**. Add optional `Meta.slideHeight` (absent ⇒ 1080,
mirroring the `pxPerPt` pattern). The importer records the deck's true
logical height (`round(1920 × cy/cx)`) and scales **isotropically**
(`sy = sx = 1920/cx`). Every renderer/editor/export site that used the
`SLIDE_HEIGHT` constant for the *current deck* reads the per-deck height
instead. Width-only sites are untouched.

`emuScale` becomes isotropic (16:9 decks are unchanged — `sy` already
equalled `sx` for them). A new `deckSlideHeight(meta)` accessor
centralizes the fallback.

## Scope decision

- **In:** model field + accessor + migration; importer height + isotropic
  scale; renderer; presenter; editor + ruler guide clamp; frontend fit/zoom
  + insert-image; PDF export page/raster; PPTX export `cy` + `pxToEmuY`;
  desktop + mobile thumbnail aspect; built-in-layout placeholder rescale.
- **Built-in layouts:** rather than a function-of-height refactor across 11
  consumers, `scaleLayoutsToHeight` rescales the built-ins' placeholder
  y/h once at the PPTX import merge (the single point they enter a non-1080
  document — `dedupeLayouts` keeps the built-in on id collision). New blank
  decks stay 1080, so no-op. `getLayout()`'s last-resort fallback stays
  1080 (rarely hit; the deck's `doc.layouts` already carries scaled copies).

## Tasks

### Model (`packages/slides/src/model/`)
- [x] `presentation.ts`: add `Meta.slideHeight?: number` (doc: absent ⇒
      `SLIDE_HEIGHT`); add `deckSlideHeight(meta)` accessor next to
      `deckFontScale`. Keep `SLIDE_HEIGHT = 1080` as the default constant.
- [x] `migrate.ts`: preserve `slideHeight` (number/finite/>0 guard), else
      it's dropped on every Yorkie read.
- [x] `node.ts` / `index.ts`: re-export `deckSlideHeight`.

### Import (`packages/slides/src/import/pptx/`)
- [x] `geometry.ts`: make `emuScale` isotropic (`sy = sx = 1920/cx`,
      guarded); add `deckLogicalHeight(slideSizeEmu)` → `round(1920×cy/cx)`
      (guarded ⇒ 1080). Update the anisotropic-fallback test.
- [x] `index.ts`: set `meta.slideHeight` from `deckLogicalHeight` (omit
      when === 1080, matching `pxPerPt`).

### Rendering (`packages/slides/src/view/`)
- [x] `canvas/slide-renderer.ts`: `scaleY`, slide-rect fill, bg-image
      stretch read `deckSlideHeight(doc.meta)`.
- [x] `present/presenter.ts`: aspect (per-doc, not module const) +
      AnimationPlayer bounds height.

### Editor (`packages/slides/src/view/editor/`)
- [x] `editor.ts`: 14 `SLIDE_HEIGHT` sites → per-deck height helper
      `this.slideHeight()` / local `deckSlideHeight(doc.meta)`.
- [x] `ruler/interactions.ts`: guide-drag `clamp` y-max via new
      `GuideDragHost.slideHeight()`.
- [x] `thumbnail-panel.ts`: `computeThumbDims` aspect param +
      `deckThumbAspect(store)` (review finding #2).

### Built-in layouts (`packages/slides/src/model/layout.ts`)
- [x] `scaleLayoutsToHeight(layouts, slideHeight)` helper; applied to
      `BUILT_IN_LAYOUTS` at the PPTX import merge (review finding #1).

### Frontend (`packages/frontend/src/app/slides/`)
- [x] `slides-view.tsx`: `computeFitSize` aspect param + absolute-zoom
      `nextH` per-deck (`store.read().meta`).
- [x] `mobile-slides-view.tsx`: `computeFitSize` aspect param +
      `deckAspect(store)` at the 3 fit sites; `thumbH` per-deck in the
      thumbnail strip (review finding #2).
- [x] `insert-image.ts`: `computeImageFrame(w, h, slideHeight)` — `maxH`
      + vertical centering per-deck.

### Export (`packages/slides/src/export/`)
- [x] `pdf.ts`: page height + raster bitmap + `drawSlide` hostHeight
      per-deck (formula already aspect-correct).
- [x] `pptx/units.ts`: `pxToEmuY` uniform 6350 EMU/px (dropped `EMU_H`/1080).
- [x] `pptx/presentation.ts`: emit per-deck `cy` + `type` hint
      (screen16x9 / screen4x3 / custom).

### Verify
- [x] Failing tests first: geometry (isotropic + `deckLogicalHeight`),
      import (`meta.slideHeight===1440`, 2:1 image stays 2:1), ruler clamp
      per-deck height.
- [x] `pnpm --filter @wafflebase/slides test` — 2498 pass.
- [x] `pnpm verify:fast` — EXIT 0 (slides/frontend/docs/backend/sheets green).
- [x] Real-file check: imported "Yorkie branding_v1.pptx" → `slideHeight
      =1440`, 16 slides, content spans full 1440 canvas (isotropic).
- [x] Manual UI smoke in `pnpm dev`: re-imported the branding deck, no
      distortion.

## Review

### Root cause

`emuScale` mapped `sx = 1920/cx`, `sy = 1080/cy` — a per-axis fit that
forced every deck into a fixed 1920×1080 (16:9) canvas. A 4:3 deck
(`cx=9144000 cy=6858000`) got `sx/sy = 1.333`, stretching all geometry
33 % horizontally. The distortion was baked into stored coordinates at
import time, so the editor could not recover it.

### Fix

Keep `SLIDE_WIDTH = 1920` fixed; make the height per-deck via optional
`Meta.slideHeight` (absent ⇒ 1080). `emuScale` is now isotropic
(`sy = sx = 1920/cx`); `deckLogicalHeight` records `round(1920×cy/cx)`.
`deckSlideHeight(meta)` centralizes the fallback and every render / editor
/ export site reads it instead of the constant. 16:9 decks are byte-for-byte
unchanged (`sy` already equalled `sx`; `slideHeight` left absent).

### Verification

- New failing-first tests: geometry isotropy + `deckLogicalHeight`,
  `importPptx` (`slideHeight===1440`, 2:1 image stays 2:1, 16:9 omits
  the field), ruler clamp per-deck, `scaleLayoutsToHeight`.
- `pnpm --filter @wafflebase/slides test` — 2500 pass; `pnpm verify:fast`
  — EXIT 0 (slides/frontend/docs/backend/sheets).
- Real file "Yorkie branding_v1.pptx": `slideHeight=1440`, 16 slides,
  content spans full 1440 canvas, built-in `title-slide` subtitle rescaled
  600 → 800 px.

### Code review (workflow, high) — 3 confirmed findings, all fixed

1. **Built-in layout placeholders baked at 1080** → `scaleLayoutsToHeight`
   at the import merge.
2. **Thumbnails hardcoded 16:9** (desktop `thumbnail-panel.ts` + mobile
   strip) → per-deck aspect.
3. **Redundant per-frame `store.read()`** in gesture paths → reuse the
   local `doc` clone (`deckSlideHeight(doc.meta)`).
   1 finding (fit-height floors) was raised and correctly refuted (min
   floors, default aspect is fine).

### Known limitation

`getLayout()`'s last-resort fallback still returns 1080-space built-ins,
but it is only hit when a layout id is absent from `doc.layouts` (which,
post-import, already carries scaled copies) — not reachable on the normal
paths. Manual UI smoke in `pnpm dev` still pending before merge.

---

## Follow-up: user-facing "Slide size" control

The import fix set `meta.slideHeight` automatically; this adds a UI to
change it. Decisions (with the user): **placement** = Format options
panel's idle (no-selection) "Slide" section (no menu bar; deck-level
belongs with the panel that already owns Size & Position). **Resize
policy** = proportional scale of existing content.

### Store — `setSlideHeight(height)` (deck-wide, one undo step)
- [x] `SlidesStore` interface (`store/store.ts`).
- [x] `MemSlidesStore` — scales every top-level element y/h by
      `height/oldHeight`; groups pin `data.refSize` (absent) so the
      frame→refSize transform scales children (no recursion); tables scale
      row heights; connectors scale free-endpoint y then recompute frames.
- [x] `YorkieSlidesStore` — CRDT mirror (in-place proxy mutation,
      `slideElementsLookup` for connector recompute).
- [x] `LayoutEditStore` delegate.

### UI (`format-panel/`)
- [x] `SlideSizeSection` — preset Select (16:9 / 4:3 / 16:10 / Custom) +
      fixed Width + editable Height (`UnitInput`, exported from
      `size-position-section`). Rendered in `FormatPanel` idle state.

### Verify (follow-up)
- [x] `mem-set-slide-height.test.ts` — shape/group/table/connector scale,
      meta, no-op, undo (6).
- [x] `yorkie-slides-equivalence.test.ts` — Mem ≡ Yorkie for
      `setSlideHeight` over shape+table+group+connector.
- [x] `slide-size-section.test.tsx` — width fixed, height commit/no-op (4).
- [x] `pnpm verify:fast` — EXIT 0.
- [x] Manual UI smoke in `pnpm dev`: changed size, content scales + peers
      see it.
