# PPTX import — image (blipFill) backgrounds

## Problem

Importing `11. 2026 OSSCA_참여형_Project Guide_Yorkie.pptx` produces
slides with no visible background. The deck uses an image background on
every slide (`<p:bg><p:bgPr><a:blipFill r:embed="rId3">…<a:stretch/></a:blipFill></p:bgPr></p:bg>`),
but the current importer only recognises `<a:solidFill>` inside
`<p:bgPr>` and falls back to the theme's role-based background color.
The result is a flat white slide with the foreground shapes adrift on it.

Confirmed in `packages/slides/src/import/pptx/slide.ts:101-111` and
`packages/slides/src/import/pptx/master.ts:96-109`. The data model
already declares `Background.image?: ImageRef`, but nothing populates
or paints it (`packages/slides/src/view/canvas/slide-renderer.ts:128-132`
explicitly says "Image-fill backgrounds are v2").

## Scope

In:

- Slide-level `<p:bg><p:bgPr><a:blipFill>` parsing and rendering.
- Master-level `<p:bg><p:bgPr><a:blipFill>` parsing and rendering
  (inherits to slides without an explicit `<p:bg>`).
- `<a:stretch>` fill mode (OOXML default, used by the OSSCA deck).
  Implemented as "paint scaled to the logical 1920×1080 region".
- Per-blip `<a:alphaModFix>` opacity and `<a:srcRect>` crop, reusing
  the existing helpers from `import/pptx/image.ts`.

Out (defer to a follow-up):

- `<p:bgRef>` — theme background-style matrix references.
- `<a:gradFill>` / `<a:pattFill>` background fills.
- `<a:tile>` fill mode.
- Layout-level background overrides (`Layout.background` is already
  declared but the importer never sets it).

## Plan

1. **Data model**
   - `Background.image` and `MasterBackground.image` switch from the
     unused `ImageRef = { src, w, h }` to a slimmer `BackgroundImage =
     { src; opacity?; crop? }` that matches what the renderer needs
     and mirrors `ImageElement['data']`. `ImageRef` had no live
     producers, so this is a pure widening for new producers.
   - Update the `clone` helper and the re-export surface
     (`slides/src/index.ts`, `slides/src/node.ts`).

2. **Slide importer (`import/pptx/slide.ts`)**
   - `parseSlideBackground` gains the importer's archive / rels /
     uploadImage / report so it can resolve a `blipFill`. Refactor
     `image.ts` to expose a `parseBlip(blipEl, ctx)` helper that
     returns `{ src; opacity?; crop? }` so both `parsePic` and the
     background path share one code path.
   - When `<p:bgPr><a:blipFill>` is present, populate
     `background.image`. `background.fill` keeps the existing
     solid-color fallback (theme role) so transparent PNGs still get
     a sensible canvas underneath them.
   - When upload fails, fall through to the color-only path and bump
     `report.skippedImages` — never throw.

3. **Master importer (`import/pptx/master.ts`)**
   - Thread the same context into `parseBackground`. `parseMaster`
     becomes async (uploads can be async); update `parseMaster`'s
     callers in `index.ts`.

4. **Slide renderer (`view/canvas/slide-renderer.ts`)**
   - After the existing full-canvas color fill, if
     `slide.background.image` (or the inherited master image) is set,
     paint it inside the scaled 1920×1080 region via
     `drawImage(ctx, { w: 1920, h: 1080 }, image, onAssetLoad)`. The
     color stays underneath so transparent backgrounds still read
     correctly and the off-aspect strip remains the canvas color.

5. **Tests**
   - `import/pptx/slide.test.ts`: blipFill → populates
     `background.image.src`, copies opacity/crop, falls back when no
     `uploadImage` is configured.
   - `import/pptx/master.test.ts`: blipFill on master.
   - `view/canvas/slide-renderer.test.ts`: image background calls
     `ctx.drawImage` once at slide-local 0,0 with size 1920×1080.
   - `pnpm verify:fast` green.
   - Manual: re-import the OSSCA deck against a local dev server and
     visually confirm backgrounds appear.

## Risks / open questions

- **Async master parse**: `parseMaster` is currently synchronous and
  pure. Going async is contained (only its index.ts caller) but worth
  the touch.
- **Caching across slides**: every slide in the OSSCA deck references
  the same `rId3` blip → same bytes → same `uploadImage(bytes, mime)`
  call. `image.getOrLoadImage` keys by `src`, so once the URL repeats
  we share the cached `HTMLImageElement`. We just need to make sure
  the `uploadImage` callback is idempotent or that the importer
  short-circuits identical blob hashes; the current callback in
  `frontend/src/app/slides/pptx-actions.ts` uploads each call, so the
  same image gets uploaded N times. Not a correctness bug — only a
  bandwidth/storage waste — and outside this task's scope. Note it in
  the lessons file so we can revisit.
- **Yorkie schema**: `Background` is part of the slides Yorkie schema.
  Adding `image?: BackgroundImage` is a forward-compatible addition;
  removing `ImageRef`'s `w`/`h` only matters if any persisted doc has
  populated it — none do, since the renderer never read it and the
  importer never set it.

## Verification

- `pnpm --filter @wafflebase/slides test` (unit tests).
- `pnpm verify:fast` (lint + unit).
- Manual import of `11. 2026 OSSCA_참여형_Project Guide_Yorkie.pptx`
  against `pnpm dev`; confirm each slide shows its image background.
- Spot-check `Yorkie, 캐즘 뛰어넘기.pptx` (existing benchmark deck) to
  ensure we haven't regressed solid-color backgrounds.
