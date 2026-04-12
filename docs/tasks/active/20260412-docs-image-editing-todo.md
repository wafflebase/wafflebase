# Docs Image Insertion & Editing — Phase 1

**Status:** in-progress
**Design doc:** `docs/design/docs/docs-image-editing.md`
**Scope:** `packages/docs/src/{model,view}`, `packages/frontend/src/app/docs/*`

## Background

The Docs editor accepts images via DOCX import (fixed 2026-04-12) but
has no way to insert, select, resize, or edit them from the UI. This
task delivers Phase 1 of `docs-image-editing.md` — a single PR that
covers the full end-to-end Google Docs–style flow **minus** text wrap
and color/filter adjustments (those are Phase 2+).

The design doc is the source of truth for what goes in and what stays
out. This file tracks per-milestone checklist progress so the work can
be paused and resumed cleanly.

## Milestone 1 — Data model & editor API

- [x] **1a. Extend `ImageData`** with `rotation`, `cropLeft/Right/Top/Bottom`,
      `originalWidth`, `originalHeight`. Keep all fields optional.
- [x] **1b. Update `imageDataEqual`** in `packages/docs/src/model/types.ts`
      to compare the new fields.
- [x] **1c. Add `EditorAPI.insertImage(src, width, height, opts?)`** —
      inserts a new inline at the caret via `doc.insertImageInline` and
      advances the caret past it. Non-collapsed selection replacement
      is deferred until Milestone 4 where the insert flows plug in.
- [x] **1d. Add `EditorAPI.updateSelectedImage(patch)`** — shallow-merges
      the patch onto the current `ImageData` and writes it back through
      `doc.applyInlineStyle({ image: merged })`. No-op when no image is
      selected or the stored position no longer references one.
- [x] **1e. Add `EditorAPI.getSelectedImage()`** returning
      `{ data, blockId, offset } | null`.
- [x] **1f. Add `EditorAPI.selectImageAt(blockId, offset)` +
      `clearImageSelection()`** for programmatic selection. `selectImageAt`
      is a no-op if the offset does not point at an image inline.
- [x] **1g. Model-layer tests** in `packages/docs/test/model/types.test.ts`
      covering the new `ImageData` fields, `imageDataEqual`, and
      `findImageAtOffset`. Full editor-API tests are deferred to
      Milestone 2 where the jsdom editor harness lands alongside the
      overlay renderer (no editor-boot test exists today, and standing
      one up just for the API would bloat this milestone).

## Milestone 2 — Selection state & overlay rendering

- [x] **2a. Image selection state** — `selectedImage: { blockId, offset }`
      closure state in the editor. The text caret is suppressed in
      `DocCanvas.render()` whenever an image-selection rect is active.
- [x] **2b. Hit test** — container `mousedown` listener installed in the
      capture phase (so it runs before TextEditor). On a click, it walks
      `collectImageRects(layout, paginatedLayout, canvasWidth)` and, if
      the pointer lands inside an image, sets `selectedImage` and stops
      propagation. A click outside an image clears any prior selection
      and falls through to text handling.
- [x] **2c. `image-selection-overlay.ts`** view module — draws a 1px
      selection rect + eight 8×8 handles for the currently selected
      image. `DocCanvas.render()` invokes it after all pages finish
      so the overlay sits above text and table backgrounds.
      `collectImageRects` additionally walks simple (top-aligned,
      non-merged, rowSpan=1) table cells via `collectTableCellImageRects`
      so images inside cells are selectable. Merged / row-spanning /
      non-top-aligned cells remain a follow-up.
- [ ] **2d. Cursor hints** — handle-hover cursor swap is deferred to
      Milestone 3 where the resize drag state machine also owns the
      handle hit-test on pointer move. Hit test helper
      (`hitTestImageHandle` / `cursorForHandle`) is already available.
- [x] **2e. Keyboard** — `imageKeyHandler` installed on `TextEditor`.
      Delete/Backspace deletes the image inline + restores the caret;
      Escape clears the selection; any other key clears the selection
      and falls through to the normal text path.
- [x] **2f. Unit tests** — `test/view/image-selection-overlay.test.ts`
      covers `handleCenter`, `drawImageSelection`, `hitTestImageHandle`
      (including slack), `hitTestImageRect`, `cursorForHandle`,
      `collectImageRects` (with a single body image), `findImageAtPoint`
      (including block IDs that contain colons). Rotation-AABB tests
      are deferred to Milestone 7 where the rotation math lands.

## Milestone 3 — Resize interaction

- [x] **3a. Resize drag state machine** — mousedown on a handle
      captures `{ handle, startRect, startClientX/Y, previewRect }`.
      Mousemove computes a new `(width, height)` via
      `computeResizeDelta` and updates `previewRect` via
      `computePreviewRect`, then `renderPaintOnly()` repaints the
      overlay at the preview. Mouseup commits a single
      `doc.applyInlineStyle({ image: merged })` and clears the drag.
- [x] **3b. Aspect ratio lock** — corner handles use the dominant
      proportional axis (max of `|wScale - 1|`, `|hScale - 1|`) and
      drive both sides off that scale so the rect stays similar-shape.
      Holding Shift during the drag disables the lock and the corner
      becomes free-form — `aspectLock = !e.shiftKey` in the
      mousemove handler.
- [x] **3c. Min/max clamps** — `MIN_IMAGE_DIMENSION = 20` floor;
      `maxWidth = pageContentWidth` and `maxHeight = pageContentWidth
      * 2` ceiling, derived per drag so it tracks the current page
      setup. Tests cover both clamps.
- [x] **3d. Undo grouping** — mousemove **only** updates the preview
      rect (no doc mutation). The single `docStore.snapshot()` +
      `applyInlineStyle` call happens on mouseup, and a no-op
      mousedown→up without movement skips the snapshot entirely so
      the undo stack stays clean.
- [x] **3e. Keyboard nudge** — Arrow keys in `imageKeyHandler` scale
      the image proportionally: ±1px on width with height derived
      from aspect ratio (±8 with Shift). Each key press is its own
      undo step via a new `docStore.snapshot()`, matching the
      behavior for text typing. Clamps share `getResizeMax()` with
      the drag path.
- [x] **3f. Unit tests** for `computeResizeDelta` (9 cases: SE/NW/E/S
      drags, free-form vs locked corners, min/max clamps, dominant
      axis, zero delta) and `computePreviewRect` (8 anchor cases:
      corners + edges). Cursor hint hover (`handleImageMouseMove`)
      lives in integration code and is validated end-to-end manually
      rather than through a jsdom harness.

## Milestone 4 — Insert flows

- [x] **4a. Toolbar button** — `InsertImageDropdown` component added
      to `docs-formatting-toolbar.tsx` using `IconPhoto`. Two actions:
      `Upload from computer` (hidden `<input type=file>`) and `By
      URL…` (inline form inside the dropdown that stays open while
      the user types).
- [x] **4b. Upload path** — `insertImageFromFile(editor, file)` in
      `packages/frontend/src/app/docs/image-insert.ts`. Reuses the
      existing `docxImageUploader` (renamed conceptually via the new
      `uploadImageFile` wrapper) to POST to `/images`, then probes
      the resulting URL via `loadImageDimensions` and calls
      `editor.insertImage`. Errors surface as sonner toasts.
- [x] **4c. By-URL path** — `insertImageFromUrl(editor, url)` in the
      same module. Validates the `http[s]://` prefix, preflight-loads
      the URL **without** `crossOrigin` (removed to support non-CORS
      image hosts — canvas becomes tainted but `drawImage` still
      works), and calls `editor.insertImage` with the natural
      dimensions. Returns `true`/`false` so the toolbar can keep the
      URL form open on failure instead of discarding the user's input.
      Note: the URL is stored as-is (hotlinked); uploading to
      first-party storage requires a backend `POST /images/from-url`
      endpoint (tracked as Phase 2 follow-up).
- [x] **4d. Drag and drop** — `handleImageDragOver` /
      `handleImageDrop` installed on the editor container. `dragover`
      checks `dataTransfer.items` (not `.files`, which is empty during
      `dragover` for browser security) for an `image/*` entry and
      `preventDefault`s so the drop fires; `drop` extracts the `File`
      from `.files`, moves the caret to the drop position via
      `paginatedPixelToPosition`, then invokes the host-supplied
      `onImageFileDrop` callback. Non-image drops fall through to
      the browser default.
- [x] **4e. Clipboard paste** — `TextEditor.imageFilePasteHandler`
      new field. `handlePaste` iterates `clipboardData.items`,
      extracts the first `image/*` file, and routes it through the
      callback. Takes priority over text paste so a clipboard with
      both `image/png` + `text/plain` (common for screenshot tools)
      lands the image.
- [x] **4f. Clamp on insert** — extracted `clampImageToWidth(width,
      height, maxWidth)` pure helper into `model/types.ts`.
      `EditorAPI.insertImage` calls it against the current page's
      content width on every insert so huge screenshots scale down
      proportionally, with height floored at 1px.
- [x] **4g. Unit tests** for `clampImageToWidth` (7 cases: fit,
      scale, rounding, height-floor, zero/negative width, exact fit).
      End-to-end upload + paste + DnD are validated manually via the
      dev server — no jsdom editor harness exists today and bringing
      one up for these flows would balloon the milestone.

## Milestone 5 — Floating context bar

- [ ] **5a. React overlay component** — `image-context-bar.tsx`
      absolutely positioned above the canvas, anchored to the
      selected image's screen-space top-left.
- [ ] **5b. Buttons** — Replace / Alt text / Image options / Delete,
      using existing `@/components/ui` primitives.
- [ ] **5c. Replace** — reuses the upload flow, but on success calls
      `updateSelectedImage({ src, originalWidth, originalHeight })`
      instead of `insertImage`.
- [ ] **5d. Alt text** — inline popover with a text input.
- [ ] **5e. Reposition on scroll/resize** — listen to the canvas scroll
      and window resize; recompute anchor; hide while mid-drag.

## Milestone 6 — Image Options side panel

- [ ] **6a. Panel shell** — slide-in panel on the right side of
      `docs-detail.tsx`, visibility controlled by a `showImageOptions`
      state. Close button + click-outside dismiss.
- [ ] **6b. Size controls** — Width/Height number inputs with a Lock
      aspect ratio checkbox (default on). Debounced dispatch to
      `updateSelectedImage`.
- [ ] **6c. Rotation controls** — `Rotate 90° CCW` / `Rotate 90° CW`
      buttons + free-angle slider (0..359) + numeric input.
- [ ] **6d. Alt text field**.
- [ ] **6e. Reset image** — restores `originalWidth/Height`, clears
      rotation and crop.

## Milestone 7 — Rendering: rotation & crop

- [ ] **7a. Rotation in `doc-canvas` body render path** — wrap the
      `drawImage` call in `save/translate/rotate/restore`.
- [ ] **7b. Rotation in `table-renderer.renderTableContent`** — same
      transformation wrapper so table-cell images rotate too.
- [ ] **7c. Crop** — switch to the 9-arg `drawImage` form with
      `sx/sy/sw/sh` computed from `crop* * natural*`. Works in both
      renderers.
- [ ] **7d. Hit-test AABB** — `getImageBoundingBox(data)` returns the
      axis-aligned bbox of the rotated, cropped image.
- [ ] **7e. Unit tests** for the bbox math and for a regression that
      checks rotated image draws land at the expected canvas coords
      (use a recording ctx like the existing table-renderer tests).

## Milestone 8 — Crop mode

- [ ] **8a. Crop mode toggle** — the context bar `Image options →
      Crop` or a dedicated Crop button enters crop mode: the eight
      handles become crop handles (drawn inside the image bounds) and
      a darkened overlay masks the cropped-away areas.
- [ ] **8b. Crop drag** — dragging a crop handle adjusts one of the
      four crop fractions. Clamp so `cropLeft + cropRight < 0.9` and
      `cropTop + cropBottom < 0.9`.
- [ ] **8c. Commit / cancel** — Enter or clicking outside commits;
      Esc cancels and restores prior crop values.
- [ ] **8d. Reset crop** — clears all four crop fields.

## Milestone 9 — Verification

- [ ] `pnpm --filter @wafflebase/docs test` — all existing + new tests
- [ ] `pnpm verify:fast`
- [ ] Manual: insert via toolbar upload, URL, drag-drop, paste
- [ ] Manual: resize (corner aspect lock, side axis-only, keyboard
      nudge, Shift release)
- [ ] Manual: rotate 90° CW/CCW and free angle
- [ ] Manual: crop + reset
- [ ] Manual: alt text persists across reload
- [ ] Manual: DOCX round-trip (import → resize → export → reimport) is
      lossless for width/height/alt; rotation and crop degrade
      gracefully if DOCX doesn't round-trip them

## Out of scope (tracked separately)

- Text wrap modes (square, break, behind, in front of text) — needs
  float-aware layout; separate design doc update
- Recolor / filters / brightness / contrast / transparency
- Border, shadow, link-on-image
- Drive / Photos / Web-search / Camera sources
- Non-inline positioning (page / paragraph anchor)

## Review

_(filled in as each milestone lands)_
