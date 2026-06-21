# Slides image crop (P0 — rectangular crop)

> **Shipped & archived (2026-06-21):** delivered in PR #385. Verified in
> source: `packages/slides/src/model/image-crop.ts`,
> `packages/slides/test/model/image-crop.test.ts`,
> `packages/slides/test/view/editor/image-crop-session.test.ts`. The checkbox
> states below were back-filled in bulk at archival time. See the paired
> lessons file.

Design: `docs/design/slides/slides-image-crop.md`
Branch: `slides-image-crop`

## Goal

Interactive free rectangular crop over the existing `ImageElement.data.crop`
model/renderer/PPTX-import. Enter on an image, drag 8 black handles to trim,
pan the image under a fixed window, commit as one undo step.

## Plan

- [x] **Math core** — `packages/slides/src/model/image-crop.ts` (pure)
  - [x] `cropToFull(frame, crop)` → full-bitmap rect in slide coords
  - [x] `windowToCrop(full, window)` → normalized `Crop`
  - [x] `clampWindowToFull` / `clampFullToWindow` (handle drag / pan)
  - [x] `applyCropHandle(full, window, handle, dx, dy, min)` → window
  - [x] `normalizeCrop` (≈identity → `undefined`)
  - [x] `resetFrameForUncrop(frame, crop)` → frame restoring proportions
  - [x] Unit tests `image-crop.test.ts` (round-trip, clamp, reset)
- [x] **Renderer** — dimmed-full + bright-window crop preview
  - [x] `drawCropPreview` in `view/canvas/image-renderer.ts`
  - [x] thread `cropPreview?` through `drawSlide` / `forceRender`, skip the
        cropping element (mask)
  - [x] renderer test (ctx-spy: dim pass + clipped bright pass)
- [x] **Editor session** — `view/editor/editor.ts`
  - [x] `croppingElementId` + `cropSession` state
  - [x] `enterCropMode` (public) / `exitCropMode` / `finishCropMode`
  - [x] `onDoubleClick` image branch → enter crop (top-level, rotation 0)
  - [x] `onPointerDown` crop branch: handle-drag / pan / commit-on-outside
  - [x] Enter = commit, Esc = cancel (key handler)
  - [x] live preview via `forceRender(..., cropPreview)`; one `store.batch`
  - [x] filter cropping element out of normal selection overlay
- [x] **Overlay** — `view/editor/overlay.ts`
  - [x] `cropWindow?` option → black 8 handles + window border, early-return
- [x] **Toolbar** — `frontend/.../toolbar/image-controls.tsx`
  - [x] enable Crop button → `editor.enterCropMode`; pressed state
  - [x] Reset crop: restore proportions (`resetFrameForUncrop` + clear crop)
- [x] **Tests + verify**
  - [x] interaction unit/integration (enter via dblclick + toolbar; commit/cancel)
  - [~] visual harness scenario (`slides-scenarios.tsx` + `verify-visual-browser.mjs`)
        — **deferred** (flaky async image load); jsdom interaction tests cover
        the session end-to-end (see Deviations below)
  - [x] `pnpm verify:fast` green
- [x] **Review** — `/code-review` over branch diff; address blocking findings
- [x] **Docs** — update `packages/slides/README.md` image section; lessons file

## Decisions / constraints

- P0 = **rectangular** crop only. Crop-to-shape (mask) + aspect presets = P1.
- Crop only for **top-level, non-rotated** images (mirrors table-cell-edit guard).
  Rotated / grouped images: no crop entry in P0.
- Crop math is renderer-agnostic of natural size (crop is a normalized
  fraction; `full`/`window` derive from frame+crop only). Existing
  source-rect renderer stays the truth for committed paint.
- Mutually exclusive with text-edit; suppress resize/rotate/drag while cropping.

## Review

Implemented and self-reviewed (high-effort multi-agent pass). Status:

- **Math core** ✅ `model/image-crop.ts` + 14 unit tests (round-trip, clamp,
  handle, pan, normalize, reset). Renderer-natural-size-agnostic.
- **Renderer** ✅ `drawCropPreview` (dimmed-full + clipped bright window),
  threaded `cropPreview?` through `drawSlide`/`forceRender`, masks the
  cropping element. ctx-spy test (`clip` added to the spy).
- **Editor session** ✅ `enterImageCrop` / `exitImageCrop` /
  `finishCropSession` / `resetImageCrop`, double-click + toolbar entry,
  `onPointerDownCrop` (trim / pan / outside-commit), modal capture-phase
  key handler (Enter=commit, Esc=cancel), single batched undo, mutual
  exclusion with text edit. 6 jsdom interaction tests.
- **Overlay** ✅ `cropWindow` option → white border + 8 black handles,
  short-circuits selection chrome.
- **Toolbar** ✅ Crop button enabled (pressed-state via `onCropChange`);
  Reset crop restores proportions through `editor.resetImageCrop`.
- `pnpm verify:fast` green (frontend/slides/sheets/docs/backend all pass).

### Review fixes applied

- Added `disposed` guard to `repaintOverlay` (was unguarded vs `render`),
  fixing a paint-into-detached-overlay leak on detach-mid-drag.
- DRY'd the two crop-drag loops into `runCropDrag`, which also guards
  against a session that ends mid-drag (`this.cropSession !== session`).
  New test locks this in.
- Removed dead `cropSession.before` snapshot (cancel is a pure no-op) and
  the now-unused `Crop` import; removed dead test scaffolding.

### Deviations from the design doc

- Pure crop math lives in `model/image-crop.ts` (model layer, reusable)
  rather than `view/editor/interactions/crop.ts` — the geometry is
  renderer-agnostic data math, so the model layer is the right home.
- **Visual harness scenario deferred.** Harness image loading is async /
  flaky; jsdom interaction tests cover the session end-to-end. Follow-up:
  add a crop-mode scenario to `slides-scenarios.tsx` +
  `verify-visual-browser.mjs` (kept in lockstep) once a deterministic
  image-load hook exists.

### Rotation support (follow-up to the first cut)

Rotated images now crop too: the rect math runs in the element's
centred-local frame, and only render / handles / pointer apply the
`(center, θ)` transform (`drawCropPreview` translate+rotate,
`localToWorld` handles, `R(-θ)` pointer deltas; `windowToFrame` on
commit preserves rotation). `θ=0` is the same code path. Added
`rotateVec` / `frameToLocalWindow` / `windowToFrame` to `image-crop.ts`
(+ tests) and a rotated-image interaction test.

### Known limitations (P1)

- Rectangular crop only — no crop-to-shape / aspect presets / Fill-Fit.
- Crop entry gated to **top-level** images (grouped images carry
  parent-local frames → would need a scope transform).
- Modal key handler swallows editor shortcuts during crop but does not
  `preventDefault` browser-native ones (Ctrl+S/P/F) — intentional;
  revisit if it annoys.
