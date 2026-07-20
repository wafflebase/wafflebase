# Lessons — Documents bulk multi-select move + drag-and-drop

_(Capture patterns and corrections as they come up during implementation.)_

## Context notes from exploration

- TanStack `rowSelection` was already wired in `document-list.tsx` (state,
  `onRowSelectionChange`, `data-state` on the row) but **inert** — no checkbox
  column, no bulk bar. The feature is mostly UI on top of existing plumbing.
- Folders render as a **card grid above the table**, not as table rows (the v1
  design doc's "folders as rows" plan wasn't followed) — they are the natural
  DnD drop targets.
- `useWindowFileDrop` reacts only to `dataTransfer.types.includes("Files")`, so
  an internal row→folder drag with a custom MIME type won't collide with the
  upload-drop overlay.
- Move/delete were single-id only, frontend and backend; no bulk endpoint existed.
