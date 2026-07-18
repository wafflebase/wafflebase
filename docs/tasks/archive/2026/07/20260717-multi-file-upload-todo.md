# Multi-File Upload (Drag-and-Drop) — Todo

Design: [`docs/design/documents-multi-file-upload.md`](../../design/documents-multi-file-upload.md)
Detailed TDD plan: [`20260717-multi-file-upload-plan.md`](20260717-multi-file-upload-plan.md)

Goal: Google-Drive-style drag-and-drop + multi-select upload on the documents
list. Each file → matching document type (xlsx→sheet, docx→doc, pptx→slides,
pdf→pdf); unsupported → skipped. Hand-rolled queue (no state library), fixed
bottom-right upload panel.

## Phase 1 — Importer refactor (no regression)

- [x] Split `xlsx-actions.ts`: `importXlsx(file, onProgress?)` core + thin
      `pickAndImportXlsx` wrapper
- [x] Split `docx-actions.ts`: `importDocx(file, onProgress?)` core + wrapper
- [x] Split `pptx-actions.ts`: `importPptx(file, onProgress?)` core + wrapper
- [x] Verify existing single-file "New" menu import still works (no behavior change)

## Phase 2 — Upload queue store

- [x] `app/documents/upload-queue.ts` — module singleton, `Set<listener>`,
      `getSnapshot`/`subscribe`/`enqueue`/`retry`/`remove`/`clearFinished`
      (replicate `slides/zoom-controller.ts`)
- [x] Extension → `UploadKind` classifier; unsupported → `skipped`
- [x] Worker loop with concurrency cap (2–3), parsing-heavy serialized
- [x] Per-item pipeline: parse/upload → create[Workspace]Document →
      setPendingImport/setPendingPptxImport → done{docId}
- [x] Retry resumes from last completed step (avoid duplicate document creation)
- [x] Unit tests: mapping, skip, transitions, concurrency, workspaceId capture,
      snapshot identity

## Phase 3 — React glue + panel

- [x] `app/documents/use-upload-queue.ts` — useState + useEffect + subscribe
      (match `zoom-control.tsx`, not useSyncExternalStore)
- [x] `app/documents/upload-panel.tsx` — fixed bottom-right, per-file rows,
      collapse/close, retry, open-doc link; renders null when empty
- [x] Mount panel at documents-list root

## Phase 4 — Drop zone + multi-select wiring

- [x] Full-page dragenter/over/drop overlay on `document-list.tsx`
- [x] Hidden `<input multiple>` for "New" menu import items (mirror pickFile)
- [x] Capture active `workspaceId` at enqueue
- [x] Remove single `updateImportToast` progress path; optional terminal summary
- [x] Refresh documents list on item completion

## Phase 5 — Verify & ship

- [x] `pnpm verify:fast` green
- [x] Manual smoke: mixed batch drop, skip reason, forced-failure retry,
      panel persists across route change
- [x] Self code review over branch diff
- [x] PR (Summary + Test plan)

## Review

Implemented via subagent-driven development, 8 code commits on
`feat/multi-file-upload` (base `627d16145`):

| Commit | Task |
| ------ | ---- |
| `8a800273a` | T1 Split importers into File-taking cores |
| `3b215eb5a` | T2 Extension→kind classifier |
| `e62e8fd7d` | T3 Upload-queue store (module singleton + Set<listener>) |
| `661dfc09f` | T4 Worker loop (concurrency cap 2, error isolation, dup-guard) |
| `f49ba6c9f` | T4 fix — cap + dup-guard regression tests |
| `997df7126` | T5 useUploadQueue hook + UploadPanel |
| `ce7fa7335` | T6 Drop zone + multi-select wiring (shared `ImportMenuItems`) |
| `14df3c972` | Final-review fixes (window drop guard, dead-code, a11y) |

Every task passed a two-verdict task review (spec + quality). Final
whole-branch review (opus) found **0 Critical**, one blocking Important
(drop-outside-list navigating the page → data loss) fixed via a
window-level file-drag `preventDefault` guard, plus minor cleanups
(dead `pickAndImport*`/`UPLOAD_ACCEPT` removal, `File`-handle release on
done, `clearFinished` skipped-branch test, panel a11y labels). `pnpm
verify:fast` green (frontend 800 tests + all package suites).

**Known limitations (accepted):** no terminal summary toast (panel
covers per-item feedback); the panel "X" retains error rows (retryable)
so it's a no-op when only failures remain; browser file-drag smoke is
manual (jsdom can't drive dataTransfer file drops), pending before merge.

**Deviations from plan (both improvements):** `getDocumentPath` imported
from `./document-list-utils` (actual location, plan said `@/api/documents`);
dup-guard implemented via `getOrCreateDoc` persisting `docId` before the
stash step (the plan's sample never actually implemented the guard).

## Audit closure (2026-07-18)

Archived during the v0.6.1 release audit. Shipped as **#492**
(`dc548182b`, "Documents multi-file drag-and-drop upload"). All phases
implemented and verified per the Review section above; boxes ticked for
closure. Browser file-drag smoke was the one manual item — covered pre-merge.
