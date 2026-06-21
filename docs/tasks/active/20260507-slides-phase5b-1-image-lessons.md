# Slides Phase 5b-1 (Image Input) — Lessons

## Always re-check the plan against the live code before resuming

The original plan proposed `SlidesEditor.insertImage` + a slides-package
`image-frame.ts`. Neither existed; image insertion had landed via a
frontend `insert-image.ts` + `store.addElement` instead. Resuming straight
from the plan would have built a parallel, conflicting path. Gap-analysis
first (which of the three input paths actually exist, with file:line) was
the load-bearing step. Result: toolbar picker existed; drag-drop, paste,
and the 80 % insert cap were missing.

## Drag-drop and paste want different hosts

- `drop` / `dragover` → the **canvas wrapper**. Drop events dispatch to the
  element under the cursor, so canvas-scoping is correct and avoids
  hijacking drops elsewhere on the page.
- `paste` → the **document**. When no text box is focused the paste target
  is `document.body`; a canvas-scoped paste listener never fires for the
  common "copy elsewhere, click slide, Cmd+V" case. This also matches the
  slides editor's existing document-level keydown model (`editor.ts:2113`),
  so element-paste (Cmd+V → `readClipboard` JSON) and image-paste cohabit:
  whichever the clipboard actually holds wins; the other no-ops.

Guard the document paste with an extra check so it doesn't steal a paste
meant for an unrelated `<input>` / textarea / contenteditable (the
document-title field), on top of the `getEditingElementId()` text-box gate.

## Late-loading deps → capture the callback in a ref

The parent's `uploadFn` is `useCallback([workspaceId])`; its identity flips
once the workspace id loads. The slides-view mount effect runs once
(`[didMount, doc]`), so a listener closing over `uploadFn` directly would
freeze the pre-load version that throws "not loaded yet". Mirror the
existing `onStartPresentationRef` pattern: store `uploadImage` in a ref
updated every render and have the listener read `ref.current`.

## jsdom event constructors are unreliable — synthesise events instead

`new DragEvent(...)` / `new ClipboardEvent(...)` aren't dependable under
jsdom. Tests dispatch a plain `Event('drop'|'paste')` with a
`dataTransfer` / `clipboardData` property defined via `Object.defineProperty`,
and assert through a real `MemSlidesStore`. Keeps the drop/paste/gate/cleanup
logic covered without depending on jsdom DnD internals (and dodges the
flaky-test trap noted in prior memories).

## The dragover gate must not call getAsFile() (drop silently no-op'd)

First cut shared one helper between the `dragover` gate and the `drop`
extractor: `hasImageFile = pickImageFile(dt) !== null`, and `pickImageFile`
reads `item.getAsFile()`. But during `dragover` the browser withholds file
contents — `getAsFile()` returns `null` and `dataTransfer.files` is empty
(only `item.kind` / `item.type` are exposed). So the gate was always false
mid-drag, `onDragOver` never called `preventDefault()`, the browser kept the
default "navigate to file" behaviour, and `drop` never fired. Clipboard
paste was unaffected (it only reads at `paste` time, where contents are
available), which is exactly the symptom the user reported: paste worked,
drag-drop didn't.

Fix: split the two. `hasImageFile` (dragover gate) checks only
`item.kind === 'file' && item.type.startsWith('image/')`; `pickImageFile`
(drop/paste extractor) keeps `getAsFile()` / `files`. Also `preventDefault`
on both `dragenter` and `dragover`. Regression test locks it: a transfer
whose `getAsFile()` returns `null` (mid-drag) must still report
`hasImageFile === true`.

Lesson: the unit test that "passed" used a drop-shaped transfer (`files`
populated), so it never exercised the dragover phase. When testing DnD,
simulate the dragover transfer shape (items with `type` set, `getAsFile`
→ null) separately from the drop shape.

## Code-review fixes (don't gate drop on edit mode; guard paste behind modals)

A high-effort review surfaced four real issues, all fixed before PR:

1. **Drop while editing navigated the tab (data loss).** The first cut
   gated `dragover`/`drop` on `getEditingElementId() === null` and bailed
   *before* `preventDefault`. But the slides text box installs no drop
   handler, so a drop on bare canvas while editing fell through to the
   browser default → navigate to the `file://` URL → editor unmounts.
   Fix: drop is NOT gated on edit mode; it always `preventDefault`s and
   inserts (matches Google Slides). Only **paste** keeps the edit gate
   (the text box's textarea genuinely owns paste).
2. **Paste behind a modal inserted a stray image.** The document-level
   paste listener didn't know about open Radix dialogs (shortcuts/share/
   comments); a paste meant for the dialog dropped an image onto the
   hidden slide. Fix: the paste guard also bails when
   `activeElement.closest('[role="dialog"],[role="alertdialog"],[aria-modal]')`.
3. **Silent swallow when no current slide.** `preventDefault` ran before
   the `slideId` check, consuming the drop/paste with no feedback. Fix:
   for paste, resolve `slideId` before `preventDefault`; for drop, still
   consume (so the browser can't navigate) but bail cleanly if no slide.
4. **`computeImageFrame` NaN on a non-finite dimension.** `Infinity > 0`
   is true, so the `> 0` guard passed and `Infinity * scale` produced
   NaN — an unrenderable frame persisted to the CRDT. Fix: require
   `Number.isFinite` on both dims and never multiply on the bad path
   (collapse to a finite centred 0×0).

Non-blocking (logged as follow-up, not done here): `hasImageFile` /
`pickImageFile` + the drag/paste plumbing are a third copy of the same
logic in docs (`packages/docs/src/view/editor.ts` `hasImageItem` /
`getImageFile`) and sheets (`sheet-view.tsx`); `computeImageFrame`'s
fit-center math duplicates `presenter.ts` / `thumbnail-panel.ts`. A
shared `installImageInput({ host, isEditingGuard, onFile })` +
`fitInside` util across docs/sheets/slides would collapse all three.

## Keep insert-frame policy where the upload is

Cap-at-80 % + centre lives in the frontend `insert-image.ts`
(`computeImageFrame`) next to the uploader, not in the slides package. The
slides model stays free of insert-frame policy; all three input paths funnel
through the one helper, so there's a single place to change the cap.
