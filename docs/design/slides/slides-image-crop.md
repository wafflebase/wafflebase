---
title: slides-image-crop
target-version: 0.5.0
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# Slides Image Crop (P0 — rectangular crop)

## Summary

Slides images carry a normalized `crop` rectangle in the data model, the
Canvas renderer paints through it, and the PPTX importer produces it. The
**interactive crop UX** described here is now shipped: a user can define
and adjust a crop in the editor. The toolbar `IconCrop` button is active
(it was previously a disabled placeholder).

P0 delivers **free rectangular crop** (Google Slides / PowerPoint basic
crop): enter a crop session on an image, drag eight black crop handles
to trim the edges, pan the image underneath a fixed crop window, and
commit. Crop-to-shape (masking) and aspect-ratio presets remain P1 and
live in their own follow-up.

## Goals / Non-Goals

### Goals

- A user can enter crop mode on a selected image via (a) double-click on
  the image, or (b) the toolbar Crop button (enable the existing
  placeholder in `image-controls.tsx`).
- In crop mode the **full image** is shown: the kept region at full
  opacity, the trimmed region dimmed, with eight black crop handles on
  the crop window.
- Dragging a crop handle resizes the crop window (trims edges); dragging
  the image body pans the source under a fixed window. Both gestures
  recompute `data.crop` and the element `frame`.
- Commit on `Enter`, click-outside, or selecting another element;
  cancel on `Esc` restoring the pre-session crop/frame.
- The whole crop edit is **one undo step** (`store.batch`), and syncs to
  collaborators through the normal Yorkie store path.
- Round-trips: a crop produced here re-imports/re-exports through PPTX
  `<a:srcRect>` unchanged (the importer already maps to the same `Crop`).
- The existing **Reset crop** button keeps working (clears `data.crop`
  and restores the frame to the uncropped image's natural box).

### Non-Goals

- **Crop-to-shape / masking** (non-rectangular crop via `ShapeKind`
  outlines). Tracked as P1; requires a new `maskShape` field and a clip
  path in the renderer. See "Future work".
- **Aspect-ratio presets** (16:9, 1:1, …) and **Fill/Fit** menu. P1.
- Cropping non-image elements (video, shapes with picture fill).
- Multi-image crop (crop is single-selection only, matching GS/PPT).

## Proposal Details

### Surface (shipped)

| Concern | Where | State |
| --- | --- | --- |
| Model | `model/element.ts` — `ImageElement.data.crop?: Crop`, `Crop = { x, y, w, h }` normalized `0..1` of natural image | ✅ |
| Crop math | `model/image-crop.ts` — `effectiveCrop`, `cropToFull`, `windowToCrop`, `applyCropHandle`, `panFull`, `normalizeCrop`, `frameToLocalWindow`, `windowToFrame`, `rotateVec`, `MIN_CROP_PX` | ✅ |
| Render | `view/canvas/image-renderer.ts` — `drawImage` maps the crop source-rect onto the element frame; `drawCropPreview` paints the crop-mode overlay (called from `view/canvas/slide-renderer.ts`) | ✅ |
| PPTX import | `import/pptx/image.ts` — `<a:srcRect>` and `<a:stretch><a:fillRect>` → `Crop` | ✅ |
| Store ops | `store.ts` — `updateElementFrame`, `updateElementData`, `batch` | ✅ |
| Toolbar slot | `packages/frontend/src/app/slides/toolbar/image-controls.tsx` — Replace / Crop (active) / Reset crop | ✅ |

The crop semantics are fixed by the renderer: **the crop source-rect is
stretched to fill the element frame.** So `crop` answers "which sub-rect
of the source bitmap is visible", and `frame` answers "where/how big
that sub-rect is drawn on the slide". Crop mode is the UI that lets the
user move the boundary between these two without distorting the picture.

### Coordinate model

Let the image's natural size be `(NW, NH)` and the current state be
`frame = { x, y, w, h }` and `crop = { cx, cy, cw, ch }` (defaulting to
`{0,0,1,1}` when absent).

Because the source-rect `crop·N` is stretched onto `frame`, the implied
**full-image rectangle** in slide coordinates (the box the whole bitmap
would occupy at the current scale, undistorted only when
`frame.w/frame.h == (cw·NW)/(ch·NH)`) is:

```
fullW = frame.w / cw
fullH = frame.h / ch
fullX = frame.x - cx · fullW
fullY = frame.y - cy · fullH
```

During a crop session we treat `full = {fullX, fullY, fullW, fullH}` as
the displayed bitmap and the element `frame` as the crop window over it.
Every gesture updates `frame` and/or `full`, then on commit we derive
the stored values back:

```
cw = frame.w / fullW          cx = (frame.x - fullX) / fullW
ch = frame.h / fullH          cy = (frame.y - fullY) / fullH
```

`crop` is clamped to `[0,1]` on each axis (the window cannot extend past
the bitmap), and a degenerate near-`{0,0,1,1}` result is normalized to
`undefined` so an "uncropped" image stays uncropped in the model.

> Aspect note: free crop keeps `full` proportional to `NW:NH` (no image
> distortion). The current renderer would still honor a non-proportional
> frame/crop pair, but P0 never produces one; proportional Fill/Fit
> handling is P1.

#### Rotated images

Crop works on rotated images too, by running the **exact same rect math
in the element's centred-local frame** (origin at the frame centre,
rotation removed). The session fixes `center = frame centre` and the
angle `θ = frame.rotation`; `full`/`window` are axis-aligned rects in
that local frame. Only three places apply the rotation:

- **Render** — `drawCropPreview` does `translate(center); rotate(θ)`
  before painting the dimmed-full + clipped-window (centred-local coords).
- **Handles** — the overlay places the eight handles + border at the
  rotated screen positions (`localToWorld`, same as `renderRotatedHandles`).
- **Pointer** — a world drag delta is projected into local space via
  `R(-θ)` before feeding `applyCropHandle` / `panFull`; the pan hit-test
  maps the cursor into local space the same way.

On commit, `windowToFrame(window, center, cosθ, sinθ)` converts the
centred-local window back to a stored `frame` (world `x/y/w/h`) with
`rotation = θ` preserved — a `Frame` rotates about its own centre, so the
visible pixels never jump. `θ = 0` reduces to the axis-aligned path
(`center + window`), so there is a single code path, not a special case.
Entry stays **top-level only** (grouped elements carry parent-local
frames, which would need a scope transform).

### Crop session state (editor)

The crop session mirrors the existing text-edit session machinery in
`view/editor/editor.ts` (`editingElementId` + `enterEditMode` /
`exitEditMode`). It is a parallel, mutually-exclusive session held in a
single `cropSession` field (no separate `croppingElementId`):

```ts
private cropSession: {
  slideId: string;
  elementId: string;
  full: { x: number; y: number; w: number; h: number }; // bitmap box
  window: { x: number; y: number; w: number; h: number }; // bright crop box
  ...
} | null = null;
```

- `enterImageCrop(elementId)` — commits any open text edit first (they
  are mutually exclusive). Compute `full`/`window`, set state, request a
  repaint. No store write happens on entry — the drag handlers
  mutate the editor-local session, not the store. `isCropping()` reports
  whether a session is active; `onCropChange(cb)` lets the toolbar
  subscribe to enter/exit.
- `exitImageCrop(commit: boolean)` — on cancel, nothing was written, so
  just tear the session down; on commit, write the final `frame` + `crop`
  together in one synchronous `store.batch()`, then clear state and
  repaint. (`store.batch(fn)` closes its `doc.update()` scope when `fn`
  returns, so it cannot stay open across the session's pointer events.)

Entry points:

1. **Double-click an image.** `onDoubleClick` has an `el.type === 'image'`
   branch (top-level images only) that calls `enterImageCrop(el.id)`.
   This matches Google Slides, where double-clicking an image enters crop.
2. **Toolbar Crop button.** `onClick` toggles `editor.enterImageCrop(firstId)`
   / `editor.exitImageCrop(true)` (single-selection only).

Exit: `Enter` / click-outside / select-another → `commit`; `Esc` →
`cancel`. Reuses the existing global key + outside-click plumbing that
text-edit already hooks.

### Interaction handlers

The crop hit-test → move → commit handling lives inline in the crop
session in `view/editor/editor.ts` (not a separate `interactions/crop.ts`
file), driving the `model/image-crop.ts` helpers. While a crop session is
active the normal resize/rotate/drag handlers are suppressed for that
element (the selection overlay swaps to crop chrome).

- **Crop-handle drag (trim).** Eight handles on the crop window
  (`frame`). Dragging an edge/corner moves that side of `frame`, clamped
  so the window stays inside `full` (you can shrink past nothing only to
  a small min size, and cannot grow beyond the bitmap). `crop` is
  recomputed from the new `frame` vs the fixed `full`.
- **Image pan.** Dragging inside the crop window moves `full` (the
  bitmap) under the fixed `frame`, clamped so `frame` stays within
  `full`. `crop.x/cy` shift; `crop.w/ch` unchanged.
- Each pointer-move mutates the editor-local `cropSession` (`full` /
  `window`) only; the renderer reflects it live via the crop-preview
  descriptor. The store is written once — `store.updateElementFrame` +
  `store.updateElementData(..., { crop })` in a single `store.batch()` on
  commit. Snapping/smart-guides are **off** in crop mode (P0) to keep the
  math simple.

### Rendering in crop mode

Extend the selection-overlay paint path (not `drawImage`, which stays
frame-clipped for normal render):

1. Draw the **full bitmap** `full` at ~40% opacity (the dimmed,
   trimmed-away region).
2. Draw the **kept region** — the bitmap clipped to `frame` — at full
   opacity. Equivalent to the normal `drawImage` for this element.
3. Stroke the crop window border and paint **eight black square
   handles** at `frame`'s corners/edges (distinct from the blue
   resize/rotate handles, matching GS/PPT). A thin scrim outside `full`
   is optional.

Cursor: `move` over the body (pan), directional resize cursors over
handles.

### Toolbar wiring (`image-controls.tsx`)

- The Crop button is active: `onCrop` toggles
  `editor.enterImageCrop(firstId)` / `editor.exitImageCrop(true)`, enabled
  when a single image is selected and the editor is present.
- While a crop session is active the button renders **pressed/active**
  (`aria-pressed`, muted background) with a "Done cropping" tooltip;
  clicking again commits.
- **Reset crop** routes through `editor.resetImageCrop(firstId)` so the
  `frame` is recomputed from the uncropped bitmap (restoring true
  proportions) rather than re-stretching the full bitmap into the stale
  cropped frame, in one undo step. This matches GS "Reset image".

### Collaboration

No schema change. Crop edits flow through the existing
`updateElementFrame` / `updateElementData` store ops, which already sync
via Yorkie. Concurrency follows the element's current LWW-on-field
behavior; crop is not more contended than resize. A crop session is
local/presence-free in P0 (no "user is cropping" indicator).

### Testing

- **Unit (slides):** coordinate round-trip — given `(frame, crop, NW,
  NH)`, compute `full`, apply a handle drag / pan, derive `crop'`, and
  assert it matches expected source-rect; clamp + `undefined`
  normalization; reset restores natural proportions.
- **Renderer:** crop-mode overlay paints dimmed-full + full-kept +
  handles (ctx-spy assertions, mirroring existing image-renderer tests).
- **Interaction:** enter via double-click and via toolbar; commit on
  Enter / outside-click; cancel on Esc leaves the model unchanged (no
  store write occurred); mutual exclusion with text-edit.
- **PPTX round-trip:** crop produced in-editor exports and re-imports to
  an equivalent `<a:srcRect>` (extends existing `import/pptx/image`
  coverage).
- **Visual harness:** add a crop-mode scenario to `slides-scenarios.tsx`
  **and** `verify-visual-browser.mjs` scenarioIds (kept in lockstep).

### Rollout

Shipped in a single PR (on top of the already-landed model/render/import):
editor crop session (inline in `editor.ts`), `model/image-crop.ts`
helpers, `drawCropPreview` overlay paint, toolbar enablement, and tests
(`test/model/image-crop.test.ts`, `test/view/canvas/crop-preview.test.ts`,
`test/view/editor/image-crop-session.test.ts`).

## Risks and Mitigation

| Risk | Mitigation |
| --- | --- |
| Stretch semantics make "reset" re-stretch into the stale frame | Reset recomputes `frame` to the uncropped natural box (decided above); covered by a unit test. |
| Crop math drift between editor (full/window) and renderer (source-rect) | Single shared helper converts `(frame, crop) ↔ full`; both the overlay and the commit derive from it; round-trip unit test guards it. |
| Mode collision with text-edit / resize / drag | Crop session is mutually exclusive: entering commits any text edit; resize/rotate/drag handlers early-return while `croppingElementId` is set. |
| Non-proportional frame produces visible distortion | P0 free-crop keeps `full` proportional to `NW:NH`; non-proportional Fill/Fit deferred to P1. |
| Rotated-image crop math drift between render / handles / pointer | All three derive from the same centred-local `(center, θ)` session: `translate+rotate` to render, `localToWorld` for handles, `R(-θ)` for pointer deltas. `θ=0` is the same path, so the axis-aligned case continuously exercises it; a rotated interaction test asserts the committed `frame`/`crop`. |
| Double-click ambiguity (drill-in groups vs crop) | Reuse the existing drill-in state machine; only a **leaf** image triggers crop, exactly where text-edit would have for a leaf text/shape. |

## Future work (P1+, out of scope here)

- **Crop-to-shape / masking** — add `data.maskShape?: ShapeKind`, clip
  the bitmap to the shape path (reuse the 55-shape path-builder
  registry), preserve PPTX `prstGeom`. Cross-links: `slides-shapes.md`.
- **Aspect-ratio presets + Fill/Fit** menu on the Crop split-button.
- **Presence** — a lightweight "cropping" indicator for collaborators.
