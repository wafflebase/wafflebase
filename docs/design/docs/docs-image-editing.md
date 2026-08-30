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
   * Insert an image inline at the current caret position. Width is
   * auto-clamped to the page's content width so oversized screenshots
   * don't overflow. `src` may be any value a plain <img> element can
   * load (data: URL, absolute URL, /images/:id). The caller is
   * responsible for uploading file bytes and resolving to a URL
   * before calling this. Non-collapsed selection replacement is not
   * yet implemented — the image inserts at the focus offset and the
   * selection is left as-is.
   */
  insertImage(src: string, width: number, height: number, opts?: {
    alt?: string;
    originalWidth?: number;
    originalHeight?: number;
  }): void;

  /** Mutate the selected image's ImageData. No-op if no image selected. */
  updateSelectedImage(patch: Partial<ImageData>): void;

  /** Return ImageData + position of the currently selected image, or null. */
  getSelectedImage(): { data: ImageData; blockId: string; offset: number } | null;

  /** Programmatically select the image at (blockId, offset). */
  selectImageAt(blockId: string, offset: number): void;

  /** Drop the image selection without mutating the document. */
  clearImageSelection(): void;
}
```

Image selection is a **new kind of selection** that coexists with text
selection: when an image is selected, the text caret is hidden and the
image handle overlay is shown. Clicking elsewhere returns to text mode.

### Clipboard hooks on `TextEditor`

`TextEditor` owns the `copy`/`cut` listeners but not the image selection,
which is view-local state in `initialize()`. Three nullable hooks bridge the
two (issue #870); `initialize()` assigns all three:

```ts
class TextEditor {
  /**
   * Reads the parent editor's image selection. `handleCopy`/`handleCut`
   * consult it only when there is *no* text selection, so a text selection
   * always wins. Returns null when nothing is selected, when the block is
   * gone (a peer deleted it), or when the offset no longer holds an image.
   */
  imageSelectionProvider:
    (() => { blockId: string; offset: number; image: ImageData } | null) | null;

  /** Removes whatever the provider reports, as one undo unit. Cut only. */
  imageDeleteHandler: (() => void) | null;

  /** Drops the image selection without touching the document. Cut only. */
  imageSelectionClearer: (() => void) | null;
}
```

Two properties of the provider are load-bearing:

- It resolves the block with the **non-throwing** `findBlock`. It runs
  inside the browser's `copy` listener *before* `preventDefault()`, so a
  throw would escape the listener and let the default copy wipe the user's
  system clipboard.
- It is a *read*. The removal is a separate hook because the parent editor
  owns the selection state that has to be cleared alongside the deletion,
  and that removal must refuse to run in a read-only editor — see
  [Keyboard](#keyboard) below.

`imageSelectionClearer` exists because the two selections can be live at
once and the **text** path wins. `handleCut`'s text branch deletes text, so
it shifts the offsets the image selection is expressed in; left set, the
selection would name whatever inline landed on that offset, and the next
Delete would remove *that* image. `handleCopy` needs no such call — it
mutates nothing, so no offset moves under it.

Both handlers read `e.clipboardData` and bail **before** `preventDefault()`
when it is null. Claiming the event and then finding the clipboard
unwritable is the worst outcome available: the native copy is suppressed
and nothing is written, so the shortcut silently empties the user's system
clipboard. For cut it is also a data-loss guard — a cut that cannot write
must not delete.

`writeImageToClipboard` puts the image on the clipboard as a one-inline
paragraph, the same shape an in-document image copy produces, so it pastes
back through the ordinary `WAFFLEDOCS_MIME` path with no special case at
the other end. The `text/plain` flavour carries `image.alt`, or an empty
string when the image has no alt text.

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
| ← →                | Deselect and place the caret before / after the image |
| ↑ ↓ , Shift + arrow | Deselect and fall through to normal text navigation / selection |
| Delete / Backspace | Delete the image              |
| Cmd/Ctrl + C       | Copy the image (see below)    |
| Cmd/Ctrl + X       | Cut the image (see below)     |
| Esc                | Deselect, return to text mode |

`imageKeyHandler` is consulted at the top of `TextEditor.handleKeyDown`,
**before** its read-only guard, so every mutating branch reachable from the
table above carries its own read-only check. `deleteSelectedImageInline()`
— shared by Delete/Backspace and by cut — returns early in a read-only
editor for exactly that reason; without it a viewer could delete an image
out of a document they cannot write.

It also **re-validates** the stored `{ blockId, offset }` against the
document the way `imageSelectionProvider` does, and clears the selection
instead of writing when the pair no longer resolves. The selection is
coordinates, not a handle: a peer who deleted the block makes the
positional `deleteText` throw, and a peer who merely shifted the text
leaves the offset naming an ordinary character — deleting one character
there silently takes the wrong one.

Copy and cut are the only two keys the handler consumes **without**
`preventDefault()`. Clearing the image selection here is what left the
browser's `copy` event with nothing to write (issue #870), so the handler
returns `true` to stop the fall-through while letting the native clipboard
event fire; `handleCopy` / `handleCut` then read the image back through
`imageSelectionProvider`. Cut additionally calls `imageDeleteHandler`, so
the write and the removal land as a single undo unit, leaving the caret
where the image was.

The key is normalized (`e.key.length === 1 ? e.key.toLowerCase() : e.key`)
the same way `handleKeyDown` does it: the browser reports the *modified*
character, so Caps Lock turns Cmd+C into `'C'` and a raw comparison would
fall through to the catch-all and reintroduce #870.

A modifier's *own* keydown is consumed and changes nothing. `Meta` /
`Control` / `Shift` / `Alt` (and friends) fire **before** the character they
modify, so pressing Cmd+C delivers `key === 'Meta'` first; letting that
reach the catch-all would clear the image selection a beat before the copy
branch could read it, and #870 would survive on a real keyboard while a
test synthesizing only the combined keydown passed.

The catch-all — every other key clears the selection and falls through —
re-renders before returning. A key `TextEditor` ignores would otherwise
leave the selection overlay painted around an image that is no longer
selected.

The modifier is `e.metaKey || e.ctrlKey` — **either**, not the platform's.
`navigator.platform` is an empty string in some browsers, so a
platform-keyed choice picks the wrong modifier there and the shortcut lands
in the same catch-all. Accepting both is safe: the branch only declines to
clear the selection, and Cmd+C and Ctrl+C both mean copy.

Selecting an image — from the mousedown hit-test or the `selectImageAt`
API — goes through one `selectImageInline()` helper that also **focuses the
hidden textarea**. Nothing else does: the image mousedown handler
`preventDefault()`s and stops propagation before `TextEditor.handleMouseDown`
can focus, and a read-only editor never focuses on mount at all. Without
that call a clicked image on a read-only document receives neither the
keydown nor the browser's `copy` event, so `Cmd/Ctrl+C` over a
click-selected image would silently do nothing — on a read-only document
that is the *only* way to copy the image. Focus mutates nothing — every
write still goes through a `readOnly`-gated path.

The **context menu is not** that other way, in either mode. Its Copy entry
is gated on `hasSelection = !!editor.getActiveSelection()`, and
`getActiveSelection()` returns `null` for a click-selected image — an image
selection is view-local state, not a text range. So right-clicking an image
offers no Copy at all. Teaching the menu about image selections is a real
gap and a separate change; nothing here should be read as claiming it
already works.

### Read-only image selection

`handleImageMouseDown` runs in read-only too. It used to return at the top,
which made the read-only copy above unreachable: with no way to select an
image, a viewer had nothing to copy. Only the resize-drag branch is
editable-gated now — a resize writes to the document, a selection does not.
The overlay follows: `DocCanvas` takes the mount's `readOnly` flag and
passes `{ handles: false }` to `drawImageSelection`, so a viewer sees the
selection rectangle without eight handles offering a drag the editor would
refuse. `handleImageHover` is gated the same way and returns `false` in
read-only, so no resize cursor appears over handles that are neither
painted nor actionable.

The resize *commit* carries its own gate rather than inheriting the one on
the branch that arms the drag: `handleImageResizeMouseMove` and
`handleImageResizeMouseUp` both return early on `readOnly`, the latter
after tearing its listeners down. That is defence in depth rather than a
known hole — the client `readOnly` flag is the effective write boundary for
an anonymous viewer whenever the Yorkie auth webhook is left in shadow mode
(`YORKIE_AUTH_WEBHOOK_ENFORCE=false`), so the one CRDT write on this path
should not depend on a single unrelated branch condition staying correct.

Claiming the mousedown has one cost worth paying back explicitly: the
capture-phase handler calls `stopImmediatePropagation()`, so
`TextEditor.handleMouseDown` never runs and never records the link under
the pointer that a read-only `mouseup` follows. The image branch therefore
calls `TextEditor.recordReadOnlyLinkAtMouse(e)` itself (a no-op when
editable), which keeps a plain click on a **hyperlinked image** opening its
link for a viewer, as it did before image selection reached read-only.

### Clearing the selection when text moves under it

`selectedImage` is a `(blockId, offset)` coordinate, not a handle on the
inline, so any edit that shifts offsets leaves it naming whatever slid into
that slot. One `clearImageSelectionForMutation()` helper in `editor.ts` owns
the clear, and every entry point that can mutate text while an image
selection is still live calls it: cut's text path and every paste (through
`TextEditor.imageSelectionClearer`, wired into `handleCut` and
`applyPastePlan` — the single funnel all paste paths reach), plus the
programmatic `applySpellSuggestion` / `insertTable` / `insertImage` /
`insertPageNumber` / `insertLink` APIs and the table structure APIs
(`deleteTable`, the row/column inserts and deletes, `mergeTableCells`,
`splitTableCell`), none of which are preceded by a keydown that would have
cleared it. (`insertLink`'s caret branch inserts the URL as literal text;
its style-only branches shift nothing, but the clear is unconditional so
the rule reads "this API mutates → it clears first" with no exceptions to
remember. The table APIs clear *after* their `if (!cellInfo) return` guard,
so a call made outside a table is a true no-op.)

Three entry points drop `selectedImage` with a direct assignment rather
than through the helper: `undoFn`, `redoFn` and
`resetAfterDocumentReplace`. All three already render once at the end, and
the helper's own `render()` would run before the document had been
refreshed and the layout cache invalidated — painting the new document
through the old layout. The rule still holds for them; only the mechanism
differs. Undo/redo matter because the keyboard path is safe by accident
(`⌘Z` reaches `imageKeyHandler`'s catch-all) while the toolbar's Undo/Redo
buttons call `EditorAPI.undo()/redo()` directly and never pass a keydown.

`imageResizeDrag` holds the same kind of coordinate — a `(blockId, offset)`
captured at mousedown — so the three direct-assignment paths drop the
in-flight drag as well, through `abortImageResizeDrag()`. Nulling the field
alone would not be enough: the drag's `mousemove`/`mouseup` listeners live on
`document` and its cursor override on the canvas, so a bare assignment leaks
both and lets the next `mouseup` anywhere run the commit path against a
document that has moved on. The commit path (`handleImageResizeMouseUp`)
shares that helper for its own teardown, and reads its captured block through
`doc.findBlock` rather than the throwing `doc.getBlock` — a peer can delete
the block mid-drag, and an exception from a document-level listener has
nothing to catch it.

Two mutation sources live **outside** `editor.ts` and so cannot be
funnelled through the helper. Both call the exported
`EditorAPI.clearImageSelection()` — which *is* the same helper — themselves:

- **Find & replace.** `FindReplaceState.replaceActive` / `replaceAll` run
  straight against the `Doc` the find bar holds, deleting and inserting
  text of different lengths. `DocsFindBar` clears before each replace.
- **A remote peer's edit.** It arrives through `YorkieDocStore`, not
  through any editor entry point, so `store.onRemoteChange` in
  `docs-view.tsx` clears before `doc.refresh()`. The clear is
  unconditional: the store hands the view no diff that would distinguish
  an edit *before* the selected image (which shifts its offset) from one
  after it, and dropping the selection is the safe side of that
  ambiguity. Placing it before `refresh()` keeps the helper's own repaint
  matched to the document currently laid out, and it no-ops without
  repainting when nothing was selected — the common case, so a peer
  typing costs an idle viewer nothing.

Any future consumer that drives `FindReplaceState`, or the `Doc`
directly, owes the same call.

## Floating Context Bar *(Planned — Milestone 5)*

A small React overlay (positioned absolutely above the canvas, anchored
to the image's screen-space top) with four buttons:

- **Replace** — opens the same file picker as Insert
- **Alt text** — inline input popover
- **Image options** — opens the side panel
- **Delete**

The bar reuses existing `@/components/ui` primitives (Tooltip, Button)
to match the formatting toolbar's visual language.

## Image Options Side Panel *(Planned — Milestone 6)*

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
and resize. The floating context bar (Milestone 5), Image Options
side panel (Milestone 6), rotation & crop rendering (Milestone 7),
and crop mode (Milestone 8) are planned as follow-up PRs. Text-wrap
and filters are tracked separately beyond Phase 1.
