---
title: docs-image-editing
target-version: 0.3.3
---

# Docs Image Insertion & Editing

## Summary

Add Google Docs–style image support to the Docs editor: a toolbar
**Insert image** entry point (upload / by URL / drag-and-drop / paste),
on-canvas selection with eight resize handles, a floating context bar
for common actions, and an Image Options side panel for size, rotation,
alt text, and crop. Text-wrap is explicitly **out of scope** for this
first pass — all images remain inline (as they are today for DOCX
imports).

## Goals

- Users can insert an image from the toolbar by uploading a local file
  or pasting a URL.
- Drag-and-drop and clipboard paste land an image at the cursor.
- Clicking an inline image selects it and shows eight resize handles.
- Corner drag preserves aspect ratio; side-handle drag resizes one axis.
- A floating context bar above the selected image exposes Replace,
  Alt text, Image options, and Delete.
- Image Options side panel provides Size (px), Lock aspect ratio,
  Rotation (90° buttons + free angle), Alt text, and Reset.
- Crop mode toggles the handles into crop handles; apply on exit.

## Non-Goals

- **Text wrap modes** (square / break text / behind / in front). Needs a
  float-aware layout engine; tracked separately.
- **Recolor / filters / brightness / contrast / transparency**. Phase 3+.
- **Border, drop shadow, link-to-URL on image**. Phase 4+.
- **Drive / Photos / Web search / Camera** sources. Upload + URL only.
- Non-inline anchoring (page / paragraph / character anchor).
- Image metadata collaboration edge cases beyond what inline text
  already handles — CRDT treats the inline as an atomic character.

## Data Model Changes

`ImageData` (in `packages/docs/src/model/types.ts`) gains four optional
fields. All are backwards-compatible — existing documents keep working
unchanged because every new field has a defined default.

```ts
export interface ImageData {
  src: string;
  width: number;          // displayed width in px (post-scale, pre-crop-box)
  height: number;         // displayed height in px
  alt?: string;

  // New — Phase 1
  rotation?: number;      // degrees, default 0. Clockwise.
  cropLeft?: number;      // 0..1 fraction of natural width to hide
  cropRight?: number;
  cropTop?: number;
  cropBottom?: number;
  originalWidth?: number; // intrinsic pixel size, for "Reset image"
  originalHeight?: number;
}
```

Invariants:

- `cropLeft + cropRight < 1` and `cropTop + cropBottom < 1` (enforced by
  the crop UI; layout falls back to no-crop if violated).
- `rotation` is normalized to `[0, 360)` on write.
- `originalWidth/Height` are captured at insert time from the loaded
  `HTMLImageElement.naturalWidth/Height`. Older persisted images without
  them fall back to `width/height` for Reset.

## Editor API

New methods on `EditorAPI` (`packages/docs/src/view/editor.ts`):

```ts
interface EditorAPI {
  // ... existing ...

  /**
   * Insert an image inline at the current selection focus. Replaces
   * any non-collapsed selection. `src` may be any value that a plain
   * <img> element can load (data: URL, absolute URL, /images/:id).
   * The caller is responsible for uploading file bytes and resolving
   * to a URL before calling this.
   */
  insertImage(src: string, naturalWidth: number, naturalHeight: number, alt?: string): void;

  /** Mutate the selected image's ImageData. No-op if no image selected. */
  updateSelectedImage(patch: Partial<ImageData>): void;

  /** Return ImageData + position of the currently selected image, or null. */
  getSelectedImage(): { data: ImageData; blockId: string; offset: number } | null;

  /** Programmatically select the image at (blockId, offset). */
  selectImageAt(blockId: string, offset: number): void;
}
```

Image selection is a **new kind of selection** that coexists with text
selection: when an image is selected, the text caret is hidden and the
image handle overlay is shown. Clicking elsewhere returns to text mode.

## Selection & Handles

### Rendering

A new `image-selection-overlay.ts` view module draws, on top of the
existing canvas:

1. A 1px selection rectangle around the image's bounding box (post
   rotation).
2. Eight 8×8 square handles — four corners + four edge midpoints —
   centered on the bounding box edges.
3. During drag, a dashed preview rectangle tracks the pointer.

This overlay renders from `DocCanvas.render()` after the selection
highlight pass, so it always appears above text and table backgrounds.

### Hit testing

`DocCanvas` already maps pointer coordinates to `(blockId, offset)`. We
extend this with a pre-pass that checks whether the pointer is inside
an image's drawn rect **or** one of its eight handles. Handle hits
short-circuit the text hit-test and enter resize mode.

### Resize interaction

- Corner handle: `(dx, dy)` projected onto the rect's diagonal so the
  aspect ratio is preserved. Shift releases the lock.
- Side handle: pure width-only or height-only change.
- Minimum size: 20×20 px. Maximum: `min(pageContentWidth, 2000)`.
- On mouse-up, the editor dispatches a single `updateSelectedImage`
  with the final `{ width, height }`, producing one undo step.

### Keyboard

| Key                | Action                        |
|--------------------|-------------------------------|
| ← → ↑ ↓           | 1px nudge (size, not position — inline has no position) |
| Shift + arrow      | 8px nudge                     |
| Delete / Backspace | Delete the image              |
| Esc                | Deselect, return to text mode |

## Floating Context Bar

A small React overlay (positioned absolutely above the canvas, anchored
to the image's screen-space top) with four buttons:

- **Replace** — opens the same file picker as Insert
- **Alt text** — inline input popover
- **Image options** — opens the side panel
- **Delete**

The bar reuses existing `@/components/ui` primitives (Tooltip, Button)
to match the formatting toolbar's visual language.

## Image Options Side Panel

Opened from the context bar or from a new `Format → Image options`
menu item. The panel mounts on the right side of `docs-detail.tsx`,
reusing the same slide-in shell as future panels.

Controls:

- **Size**
  - Width (px) number input
  - Height (px) number input
  - Lock aspect ratio checkbox (default on)
- **Rotation**
  - Rotate 90° CW / CCW buttons
  - Free angle slider + number input (0..359)
- **Alt text** — single-line input
- **Reset image** — restores `originalWidth/Height`, clears crop &
  rotation

## Insert Flows

### Toolbar button

`Insert image` is a DropdownMenu with two items:

- **Upload from computer** — opens a hidden `<input type=file accept="image/*">`.
  On pick: read file → POST to `/images` (existing endpoint, already used
  by the DOCX importer's image uploader) → call `editor.insertImage`.
- **By URL** — inline text field. On submit: preflight-load the URL in a
  hidden `<img>` to capture `naturalWidth/Height`, then insert.

### Drag-and-drop

`DocCanvas` listens for `dragover` / `drop`. If the drop contains
`dataTransfer.files` with `type.startsWith('image/')`, upload and insert
at the drop coordinate's text position.

### Clipboard paste

The existing paste handler already sees `ClipboardEvent`. Extend it to
check `clipboardData.items[i].kind === 'file'` for images and route
them through the same upload helper.

## Rendering

`renderTableContent` and `DocCanvas.renderRun` already call
`getOrLoadImage` and `drawImage` (fixed in 2026-04-12). The additions
are:

- **Rotation** — wrap the `drawImage` call in `ctx.save()` /
  `ctx.translate(cx, cy)` / `ctx.rotate(rad)` / `ctx.translate(-cx, -cy)`
  / `ctx.restore()`.
- **Crop** — use the 9-arg `drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)`
  form with `sx/sy/sw/sh` derived from `cropLeft/Right/Top/Bottom *
  naturalWidth/Height`.
- The bounding box used for hit testing and the handle overlay must
  account for rotation (take the axis-aligned bounding box of the
  rotated rect).

## Collaboration (Yorkie)

Each image is a single inline with `text === '\uFFFC'` and `style.image
= ImageData`. Mutations (`updateSelectedImage`) replace the inline's
style via the existing `styleByPath` / inline replacement path. The
CRDT sees an atomic style update — no new concurrency semantics beyond
what text-run styling already handles.

Pitfall: two users resizing the same image concurrently will
last-writer-wins on `width/height`. This matches Google Docs and we
accept it for Phase 1.

## Risks & Mitigation

- **Rotation + crop + scale compound math** is easy to get wrong. Unit
  tests cover each transform independently and their composition.
- **Selection overlay repaint cost** — the handle overlay must not
  trigger a full-document re-layout. Render it as an overlay pass in
  `DocCanvas.render()`, not as a layout mutation.
- **Drag-drop hijacking text DnD** — only intercept drops whose
  `dataTransfer.files[0]` has an image MIME. Files that don't match
  fall through to the existing handler.
- **Paste of huge images** — clamp width to the page content width on
  insert so a 4000px screenshot doesn't push layout off-page.
- **Accessibility** — alt text is surfaced in the context bar and the
  side panel, and persisted through DOCX round-trip (already supported).

## Rollout

Phase 1 ships in a single PR branch `docs-image-editing-phase1` and
delivers the toolbar button, upload/URL/DnD/paste, selection handles,
resize, context bar, and Image Options panel (size + rotation + alt +
reset + crop). Text-wrap and filters are explicitly tracked as
follow-ups in a separate design doc update.
