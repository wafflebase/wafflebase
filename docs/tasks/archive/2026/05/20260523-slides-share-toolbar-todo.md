# Slides share — toolbar for editors + read-only canvas for viewers

Two related gaps in `SharedSlidesLayout`:

1. `SlidesToolbar` was never mounted, so editor-role share links had a
   canvas with no editing controls.
2. `SlidesView` accepts `readOnly` only for API parity — the underlying
   editor still binds all pointer/keyboard handlers, so viewer-role
   shares can still mutate the deck (drag elements, type into text
   boxes, reorder thumbnails, edit notes).

## Background

- `slides-detail.tsx` (owner route `/p/:id`) mounts `<SlidesToolbar>`
  immediately above `<SlidesView>`.
- `shared-document.tsx`'s `SharedSlidesLayout` mounted only
  `<SlidesView readOnly={readOnly} />` — the toolbar was missing
  entirely, and the layout didn't capture the editor/store instances
  the toolbar would need.
- `SharedDocsLayout` already shows the pattern
  (`{!readOnly && <DocsFormattingToolbar editor={editor} />}`); the
  slides side mirrors it.
- For the read-only canvas, the cleanest surgery is at the editor
  options: skipping `attachInteractions()` strips every pointer +
  keyboard listener at once. The thumbnail and notes panels need the
  same flag so drag-reorder, right-click bulk delete, and notes typing
  are gated too.

## Tasks

- [x] Editor-role toolbar: state + `SlidesView` wiring + lazy
  `SlidesToolbar` mount in `SharedSlidesLayout`.
- [x] `onImagePick`: toast info — workspace-scoped image upload isn't
  available to share-link viewers.
- [x] Slides package: add `readOnly?: boolean` to
  `SlidesEditorOptions`; skip `attachInteractions()` when true so the
  canvas + overlay + document keydown listeners never bind.
- [x] Slides package: add `readOnly?: boolean` to
  `mountThumbnailPanel`; skip drag-reorder + right-click context and
  clear `item.draggable` (keep click + ArrowUp/Down navigation).
- [x] Slides package: add `readOnly?: boolean` to `mountNotesPanel`;
  set `textarea.readOnly = true` and skip the `input` listener.
- [x] `slides-view.tsx`: thread `readOnly` through `initializeEditor`,
  `mountThumbnailPanel`, `mountNotesPanel`; skip the empty-deck seed
  (`store.batch(() => store.addSlide(...))`) when read-only.
- [x] Cover read-only behavior with vitest in `editor.test.ts`,
  `thumbnail-panel.test.ts`, `notes-panel.test.ts`.
- [x] Update `docs/design/slides/slides.md` with a "Read-only mounts"
  section.
- [x] Run `pnpm verify:fast` and confirm green.

## Non-goals

- Image upload from the shared editor (requires workspace auth).
- The theme side panel — defer to a follow-up.
- Server-side write enforcement. This PR only adds UI-level gating; a
  viewer who bypasses the UI and writes directly to Yorkie is not
  blocked by anything we ship here. Whatever (or no) protection exists
  server-side is out of scope.
