# Notes image upload

Bring image insertion to the notes markdown editor: paste, drop, and a
toolbar button, uploading through the existing workspace image endpoint and
inserting `![alt](url)` at the right place.

Ported in spirit from CodePair's `packages/codemirror/src/plugins/imageUploader.ts`
(paste/drop → presigned upload → `![image](url)` at the caret), with three of
its weaknesses fixed:

1. **No in-flight feedback.** CodePair shows nothing until the upload resolves.
2. **Insert position is "wherever the caret is now".** It reads the selection
   *after* the await, so typing during the upload drops the image mid-word —
   and a drop lands at the caret rather than where the file was dropped.
3. **Silent failure.** A rejected upload yields `undefined` and is swallowed by
   `if (!url) return`.

## Design decisions

- **In-flight feedback is a view-local ghost widget**, not text in the
  document. The note body is a single Yorkie `Text` CRDT, so a text
  placeholder would appear on every peer's screen, land in the undo history,
  and survive as garbage if the upload fails or the tab closes. A CodeMirror
  widget decoration held in a `StateField` is invisible to peers and maps
  through every transaction (local *and* remote), so the insertion point stays
  correct while the upload is in flight.
- **One insert = one undo unit.** The completed upload dispatches a single
  `userEvent: 'input'` transaction, which `noteSync` collapses into one store
  change (its "1 ViewUpdate = 1 undo unit" rule), so Ctrl+Z removes the image
  cleanly.
- **The engine never imports the frontend.** `initialize()` takes an
  `uploadImage: (file) => Promise<string | null>` callback; the frontend wraps
  `uploadImageFile` and owns validation errors and toasts. `null` means
  "cancelled" — the ghost disappears with no further engine-side reporting.
- **Never swallow a normal paste.** If the clipboard or drop carries no image,
  the handler does not `preventDefault`, so text paste/drop behaves as before.

## Tasks

- [x] `packages/notes/src/view/commands.ts` — `insertImage(view, url, alt, pos)`
- [x] `packages/notes/src/view/image-upload.ts` — ghost `StateField` + widget,
      paste/drop handlers, upload orchestration
- [x] `packages/notes/src/view/image-upload.test.ts` — paste inserts at caret;
      drop inserts at drop coordinates; ghost survives a concurrent remote
      edit; failure removes the ghost and leaves the document untouched;
      an image-free paste falls through
- [x] `packages/notes/src/view/editor.ts` — optional `options.uploadImage`,
      `insertImageFiles(files)` + `canInsertImage()` on `NoteEditorAPI`
- [x] `packages/frontend/src/app/notes/notes-view.tsx` — `uploadImage` prop
- [x] `packages/frontend/src/app/notes/notes-detail.tsx` — build the callback
      from `documentData.workspaceId` + `uploadImageFile`, toast on failure
- [x] `packages/frontend/src/app/notes/notes-toolbar.tsx` — image button
- [x] `docs/design/notes/notes.md` — replace the deferred P2 image-upload line
      with the shipped design
- [x] `pnpm verify:fast` green
- [x] Self review over the branch diff — 3 findings, all fixed (see Review)
- [ ] Manual smoke in `pnpm dev` (paste, drop, toolbar, failure, undo)

## Out of scope

- Backend changes. `POST /api/v1/workspaces/:wid/images` is shared with
  sheets/slides/board and needs nothing new.
- Preview changes. `markdown-it`'s image rule already renders `![](url)`.
- Resizing, alignment, or captions — markdown has no syntax for them, and
  notes deliberately renders no raw HTML (`html: false`).
- Inserting an image by URL. Typing `![](url)` in a markdown source editor is
  already the shortest path.

## Review

Two commits on `notes-image-upload`:

1. `b5f2fa4d4` — the feature as designed above.
2. `761729bb4` — three fixes from the branch self-review.

### What the self-review caught

- **A batch inserted in completion order, not file order.** All placeholders
  in one paste share an anchor, so the first upload to return inserted there
  and pushed the rest past it: paste three screenshots on a jittery network,
  get them back shuffled. Requests still all start at once; only the inserts
  are serialized. The original ordering test passed *vacuously* — its mock
  resolved in call order, so the out-of-order case was never exercised. The
  replacement resolves the second upload first and fails against the old code.
- **A Yorkie snapshot resync put the image at the top of the note.**
  `noteSync` applies a `replace` remote change as one change spanning the
  whole document; every anchor lives inside that deleted range, so CodeMirror
  collapses them all to position 0. Anchors are now dropped on a whole-document
  replacement and the insert falls back to the caret.
- **A failed upload toasted over an expiring session.** `isAuthExpiredError`
  is the established guard (added to board/slides in #619, now in ~15
  handlers) and was missing from the new handler.

Both engine fixes were verified by reverting them and confirming the new tests
fail — they are real regression tests, not restatements of the code.

### Known limitations

- **No image upload behind an editable share link.** A read-only mount never
  receives an `uploadImage`, and neither does the share view, because an
  anonymous share-link editor cannot authenticate to the workspace image
  endpoint. Paste and drop fall through to normal text handling there rather
  than failing loudly.
- **A stalled first upload holds back the rest of its batch.** Ordering is
  enforced by committing in sequence, so a hung request leaves the later
  images' placeholders on screen until it settles. Visible and honest, but a
  per-item timeout would be better.
- **No engine-level test of the store/undo integration.** `image-upload.test.ts`
  mounts the extension standalone, without `noteStoreFacet`/`noteSync`. The
  one-undo-unit claim rests on `insertImage` dispatching a single `input`
  transaction plus `note-sync.test.ts`'s existing coverage of that shape.
