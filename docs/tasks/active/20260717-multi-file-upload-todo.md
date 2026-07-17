# Multi-File Upload (Drag-and-Drop) — Todo

Design: [`docs/design/documents-multi-file-upload.md`](../../design/documents-multi-file-upload.md)
Detailed TDD plan: [`20260717-multi-file-upload-plan.md`](20260717-multi-file-upload-plan.md)

Goal: Google-Drive-style drag-and-drop + multi-select upload on the documents
list. Each file → matching document type (xlsx→sheet, docx→doc, pptx→slides,
pdf→pdf); unsupported → skipped. Hand-rolled queue (no state library), fixed
bottom-right upload panel.

## Phase 1 — Importer refactor (no regression)

- [ ] Split `xlsx-actions.ts`: `importXlsx(file, onProgress?)` core + thin
      `pickAndImportXlsx` wrapper
- [ ] Split `docx-actions.ts`: `importDocx(file, onProgress?)` core + wrapper
- [ ] Split `pptx-actions.ts`: `importPptx(file, onProgress?)` core + wrapper
- [ ] Verify existing single-file "New" menu import still works (no behavior change)

## Phase 2 — Upload queue store

- [ ] `app/documents/upload-queue.ts` — module singleton, `Set<listener>`,
      `getSnapshot`/`subscribe`/`enqueue`/`retry`/`remove`/`clearFinished`
      (replicate `slides/zoom-controller.ts`)
- [ ] Extension → `UploadKind` classifier; unsupported → `skipped`
- [ ] Worker loop with concurrency cap (2–3), parsing-heavy serialized
- [ ] Per-item pipeline: parse/upload → create[Workspace]Document →
      setPendingImport/setPendingPptxImport → done{docId}
- [ ] Retry resumes from last completed step (avoid duplicate document creation)
- [ ] Unit tests: mapping, skip, transitions, concurrency, workspaceId capture,
      snapshot identity

## Phase 3 — React glue + panel

- [ ] `app/documents/use-upload-queue.ts` — useState + useEffect + subscribe
      (match `zoom-control.tsx`, not useSyncExternalStore)
- [ ] `app/documents/upload-panel.tsx` — fixed bottom-right, per-file rows,
      collapse/close, retry, open-doc link; renders null when empty
- [ ] Mount panel at documents-list root

## Phase 4 — Drop zone + multi-select wiring

- [ ] Full-page dragenter/over/drop overlay on `document-list.tsx`
- [ ] Hidden `<input multiple>` for "New" menu import items (mirror pickFile)
- [ ] Capture active `workspaceId` at enqueue
- [ ] Remove single `updateImportToast` progress path; optional terminal summary
- [ ] Refresh documents list on item completion

## Phase 5 — Verify & ship

- [ ] `pnpm verify:fast` green
- [ ] Manual smoke: mixed batch drop, skip reason, forced-failure retry,
      panel persists across route change
- [ ] Self code review over branch diff
- [ ] PR (Summary + Test plan)

## Review

(fill after implementation)
