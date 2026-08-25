# Image viewer: back button + Esc to the documents list

Issue: [#840](https://github.com/wafflebase/wafflebase/issues/840)

## Problem

Opening an image document (`/f/:id`) gives a top bar with only the sidebar
toggle, the title, Download and Share. There is no back/close affordance, so
the only way back to the documents list is the browser's back button. The
viewer's keydown handler only maps ←/→ (prev/next image); Esc does nothing.

## Acceptance criteria

- [x] The image viewer's top bar shows a back button that returns to the
      documents list.
- [x] Esc in the image viewer returns to the documents list.
- [x] The destination is the document's own workspace list (`/w/:slug`),
      falling back to `/documents`.
- [x] Esc is ignored while typing in an input/textarea/contenteditable
      (e.g. the header's rename field), and does nothing for anonymous
      share-link viewers, who have no documents list.
- [x] Unchanged: pdf/file layouts, ←/→ prev/next, zoom, download, share.

## Plan

1. `use-documents-path.ts` (new, `app/files/`) — one hook resolving the
   documents-list path from a workspace id, so the button and the Esc key
   share a single definition. `FileShell`'s not-found redirect reuses it
   instead of its own copy of the same slug fallback.
2. `site-header.tsx` — optional `leading` slot rendered left of the title
   (additive; every existing caller renders exactly as before).
3. `file-shell.tsx` — optional `headerLeading` passthrough to `SiteHeader`.
4. `file-detail.tsx` — `ImageFileLayout` resolves the path, renders the back
   button into `headerLeading`, and passes `onClose` to `ImageViewer`.
5. `image-viewer.tsx` — optional `onClose`; `Escape` calls it in the existing
   keydown handler (same input/contenteditable guard as ←/→).
6. Tests — `image-viewer.test.tsx` (Esc fires / guarded / absent-onClose) and
   `use-documents-path.test.tsx`.
7. Docs — note the button + Esc in `docs/design/image-viewer.md`'s viewer
   section (behavior change to a documented list, not an architecture change).

## Non-goals

- No back/close affordance for the pdf or generic-file layouts (the issue is
  scoped to the image viewer; the `leading` slot makes adding one later a
  one-liner).
- No Esc-closes for share-link viewers, no history-aware "go back one entry".
