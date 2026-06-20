# Slides image crop (P0 — rectangular crop)

Design: `docs/design/slides/slides-image-crop.md`
Branch: `slides-image-crop`

## Goal

Interactive free rectangular crop over the existing `ImageElement.data.crop`
model/renderer/PPTX-import. Enter on an image, drag 8 black handles to trim,
pan the image under a fixed window, commit as one undo step.

## Plan

- [ ] **Math core** — `packages/slides/src/model/image-crop.ts` (pure)
  - [ ] `cropToFull(frame, crop)` → full-bitmap rect in slide coords
  - [ ] `windowToCrop(full, window)` → normalized `Crop`
  - [ ] `clampWindowToFull` / `clampFullToWindow` (handle drag / pan)
  - [ ] `applyCropHandle(full, window, handle, dx, dy, min)` → window
  - [ ] `normalizeCrop` (≈identity → `undefined`)
  - [ ] `resetFrameForUncrop(frame, crop)` → frame restoring proportions
  - [ ] Unit tests `image-crop.test.ts` (round-trip, clamp, reset)
- [ ] **Renderer** — dimmed-full + bright-window crop preview
  - [ ] `drawCropPreview` in `view/canvas/image-renderer.ts`
  - [ ] thread `cropPreview?` through `drawSlide` / `forceRender`, skip the
        cropping element (mask)
  - [ ] renderer test (ctx-spy: dim pass + clipped bright pass)
- [ ] **Editor session** — `view/editor/editor.ts`
  - [ ] `croppingElementId` + `cropSession` state
  - [ ] `enterCropMode` (public) / `exitCropMode` / `finishCropMode`
  - [ ] `onDoubleClick` image branch → enter crop (top-level, rotation 0)
  - [ ] `onPointerDown` crop branch: handle-drag / pan / commit-on-outside
  - [ ] Enter = commit, Esc = cancel (key handler)
  - [ ] live preview via `forceRender(..., cropPreview)`; one `store.batch`
  - [ ] filter cropping element out of normal selection overlay
- [ ] **Overlay** — `view/editor/overlay.ts`
  - [ ] `cropWindow?` option → black 8 handles + window border, early-return
- [ ] **Toolbar** — `frontend/.../toolbar/image-controls.tsx`
  - [ ] enable Crop button → `editor.enterCropMode`; pressed state
  - [ ] Reset crop: restore proportions (`resetFrameForUncrop` + clear crop)
- [ ] **Tests + verify**
  - [ ] interaction unit/integration (enter via dblclick + toolbar; commit/cancel)
  - [ ] visual harness scenario (`slides-scenarios.tsx` + `verify-visual-browser.mjs`)
  - [ ] `pnpm verify:fast` green
- [ ] **Review** — `/code-review` over branch diff; address blocking findings
- [ ] **Docs** — update `packages/slides/README.md` image section; lessons file

## Decisions / constraints

- P0 = **rectangular** crop only. Crop-to-shape (mask) + aspect presets = P1.
- Crop only for **top-level, non-rotated** images (mirrors table-cell-edit guard).
  Rotated / grouped images: no crop entry in P0.
- Crop math is renderer-agnostic of natural size (crop is a normalized
  fraction; `full`/`window` derive from frame+crop only). Existing
  source-rect renderer stays the truth for committed paint.
- Mutually exclusive with text-edit; suppress resize/rotate/drag while cropping.

## Review

(to fill in after implementation)
