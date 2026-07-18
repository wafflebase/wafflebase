---
title: documents-multi-file-upload
target-version: 0.6.1
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# Documents Multi-File Upload (Drag-and-Drop)

## Summary

Bring a Google-Drive-style upload experience to the documents list: drag any
number of files onto the page (or multi-select via the "New" menu) and have each
one become a document — `.xlsx → sheet`, `.docx → doc`, `.pptx → slides`,
`.pdf → pdf`. A hand-rolled upload queue drives the work with limited
concurrency, and a fixed bottom-right **Upload panel** shows per-file progress,
success, failure (with retry), and "unsupported → skipped" states.

Today every upload path takes a single file: the "New" menu's importers use
click-to-pick-one (`pickFile` reads `input.files?.[0]`, no `multiple`), progress
is a single sonner toast, and there is no drop zone on the documents list. This
design closes that gap for the documents list only.

### Goals

- Drag-and-drop of **multiple files** onto the documents list, each created as
  the matching document type.
- Multi-select through the existing "New" menu importers (add `multiple`).
- A reusable **Upload panel** (fixed bottom-right) with per-file rows: icon,
  name, status, progress, individual retry, and "open document" on completion.
- Unsupported file types are **skipped with a visible reason**, never uploaded.
- Uploads survive route changes and non-modal interaction (module-level queue).
- Hand-rolled state — **no state-management library**; follow the existing
  `packages/frontend/src/app/slides/zoom-controller.ts` module-singleton + `Set<listener>` + `subscribe` pattern.
- No regression to the existing single-file "New" menu importers.

### Non-Goals

- Storing arbitrary/unsupported files or a generic `file` document type
  (PDF stays the only binary-backed type; skipped files are not uploaded).
- Folder upload / directory recursion.
- Editor-internal multi-image insertion (docs/slides/sheets image DnD stays
  single-file; a separate effort).
- CSV import (left as a straightforward future extension of the kind-mapping;
  not shipped here).
- A backend upload queue — xlsx/docx/pptx are parsed client-side into CRDT
  documents, so a server queue adds nothing.

## Proposal Details

### Architecture & data flow

```text
[document-list.tsx]
   │  full-page dragenter/over/drop overlay + <input multiple>
   │  collect N files, capture active workspaceId
   ▼
[upload-queue.ts]                      ← single module singleton (no library)
   │  enqueue(files, workspaceId)
   │  per file → extension → kind:
   │     .xlsx → importXlsx  (client parse → sheet)
   │     .docx → importDocx  (client parse → doc)
   │     .pptx → importPptx  (client parse → slides)
   │     .pdf  → uploadPdf    (binary → S3 → pdf, fileId)
   │     else  → status 'skipped'
   │  worker loop, concurrency cap (2–3; parsing-heavy stays serial-ish)
   │  status: pending → parsing/uploading(done/total) → done | error | skipped
   │  emit to listeners on every mutation
   ▼
[use-upload-queue.ts]  useState + useEffect + subscribe  (matches zoom-control.tsx)
   ▼
[upload-panel.tsx]  fixed bottom-right; rows, collapse/close, retry, open-doc
```

### Upload queue store (`packages/frontend/src/app/documents/upload-queue.ts`)

Replicates `packages/frontend/src/app/slides/zoom-controller.ts`: a module
singleton holding `let items: UploadItem[]` and `const listeners = new Set<() =>
void>()`. Every mutator **replaces the `items` array reference** then emits
(`for (const cb of listeners) cb()`), so snapshot identity changes only on real
change.

```ts
type UploadKind = "sheet" | "doc" | "slides" | "pdf";
type UploadStatus =
  | "pending" | "parsing" | "uploading" | "done" | "error" | "skipped";

interface UploadItem {
  id: string;              // client-generated
  fileName: string;
  kind: UploadKind | null; // null when skipped/unsupported
  workspaceId?: string;    // captured at enqueue time
  status: UploadStatus;
  done: number;            // progress numerator (image-upload phase, etc.)
  total: number;
  docId?: string;          // set on success, for the "open" link
  reason?: string;         // skip reason / error message
}

// Exposed: getSnapshot(), subscribe(cb), enqueue(files, workspaceId),
// retry(id), remove(id), clearFinished()
```

Worker loop: a small in-module runner picks up `pending` items up to a
concurrency cap. Because xlsx/docx/pptx parse on the **main thread**, the cap is
low (2–3) and parsing-heavy kinds are effectively serialized to avoid UI
freezes; PDF (network-bound) can overlap freely. No external scheduler — a
simple `runNext()` invoked as slots free up.

Per-item pipeline (mirrors today's single-file handlers, section-by-section
reuse):

1. classify extension → `kind` (or `skipped`).
2. call the refactored `importXxx(file, onProgress)` / `uploadPdf(file)`.
3. `workspaceId ? createWorkspaceDocument(...) : createDocument({ title, type })`.
4. **persist content headlessly** (xlsx/docx/pptx): `applyImportedContent`
   attaches the Yorkie doc, writes the same root the editor would, and detaches
   (see below). PDF stores its bytes at create time via `fileId`, so it skips
   this step.
5. `setStatus(id, "done", { docId })`. Do **not** auto-navigate — the panel row
   links to the document; only navigate if the user clicks.

### Headless content application (`packages/frontend/src/app/documents/apply-imported-content.ts`)

The client-parsed importers produce a CRDT document that is **not** persisted at
create time. The single-file flow relied on the immediate `navigate` →
editor-mount to push the parsed object (stashed in an in-memory `pendingImports`
map) into Yorkie. The deferred queue has no navigate — a batch can complete with
no editor ever mounting — so that model would leave the backend document empty
and silently lose the content on reload. Instead the worker applies content
directly: `@yorkie-js/sdk`'s `Client`/`Document` are fully React-free, so it
`activate()`s a client, `attach`es the doc with the **same `initialRoot`** the
editor's `DocumentProvider` seeds (`initialSpreadsheetDocument()` / `initialDocsRoot()`
/ `{}`), runs the same root write the editor's mount effect runs (sheets/slides
inline `doc.update`, docs `new YorkieDocStore(doc).setDocument(...)`, slides also
`ensureSlidesRoot`), then `detach`es (flushing the write) and `deactivate`s. So
"done" means the content is actually saved, independent of whether the document
is ever opened. These writers deliberately mirror the editor mount paths and
must be kept in sync with them.

### React glue (`packages/frontend/src/app/documents/use-upload-queue.ts`)

Follows `packages/frontend/src/app/slides/toolbar/zoom-control.tsx` exactly:
`useState(getSnapshot())` + `useEffect(() => subscribe(() =>
setItems(getSnapshot())), [])`. `useSyncExternalStore` is intentionally **not**
used — there is zero precedent in the codebase and the manual pattern is the
established convention.

### Upload panel (`packages/frontend/src/app/documents/upload-panel.tsx`)

Greenfield (no existing fixed panel in the repo). Tailwind + shadcn primitives,
matching documents-list conventions:
`className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border bg-background
shadow-lg"`. Per-file rows show a type icon, truncated name, and status:
spinner + `done/total` while active, check on `done` (row links to the doc),
`text-destructive` + retry `Button variant="ghost"` on `error`,
`text-muted-foreground` "Unsupported" on `skipped`. Header has a collapse toggle
and a close/"clear finished" control. Renders `null` when the queue is empty.
Mounted once near the documents list root so it persists across in-list state.

### Drop zone & multi-select (`packages/frontend/src/app/documents/document-list.tsx`)

- Full-page `dragenter`/`dragover`/`drop` handlers gated to file drags; on
  `dragover` show a translucent overlay ("Drop files to upload"). On `drop`,
  collect `dataTransfer.files`, capture the active `workspaceId` prop, call
  `enqueue`.
- The "New" menu import items gain multi-select: a hidden `<input multiple>`
  mirroring the DOM-append + focus-cancel logic already in `pickFile`
  (`packages/frontend/src/app/docs/export-utils.ts`), then `enqueue`.
- Remove the single `updateImportToast` progress path (absorbed by the panel);
  keep an optional terminal sonner summary (e.g. "5 uploaded, 1 skipped").
- On any item reaching `done`, refresh the documents list.

### Importer refactor (no regression)

Split each `pickAndImportXxx` into a File-taking core plus a thin picker wrapper,
so the existing single-file menu keeps working:

```ts
// e.g. docx-actions.ts
export async function importDocx(file, onProgress?) { /* arrayBuffer → parse */ }
export async function pickAndImportDocx(onProgress?) {
  const file = await pickFile(".docx"); if (!file) return null;
  return importDocx(file, onProgress);
}
```

The parser cores (`importXlsxWorkbook`, `DocxImporter.import`, `importPptx`)
already take an `ArrayBuffer`/`Uint8Array` + `onProgress(done, total)`, so the
queue drives per-file progress directly.

### Testing

- Unit-test `packages/frontend/src/app/documents/upload-queue.ts` (pure logic, importers mocked): extension→kind
  mapping, skip handling, enqueue/progress/done/error/retry transitions,
  concurrency cap, `workspaceId` capture, snapshot-identity-changes-on-mutation.
- Test the subscribe/unsubscribe lifecycle of `use-upload-queue`.
- Manual smoke in `pnpm dev`: drop a mixed batch (xlsx/docx/pptx/pdf +
  unsupported), confirm each lands as the right type, skipped shows a reason,
  retry recovers a forced failure, panel persists across a route change.

### Risks and Mitigation

- **Main-thread parse freeze** — several large docx/pptx parsed at once blocks
  the UI. Mitigation: low concurrency cap (2–3), serialize parsing-heavy kinds,
  overlap only network-bound PDF; revisit a Worker offload only if needed.
- **Size-limit rejection mid-batch** — PDF > 50MB / image > 10MB is rejected by
  the backend. Mitigation: client-side early `error` with a clear per-row reason
  before the request; other items keep going.
- **Content loss without a navigate** — the single-file flow persisted content
  only when the editor mounted after `navigate`; the deferred queue never
  navigates. Mitigation: the worker persists content itself via headless
  `applyImportedContent` (above), so "done" = saved. Residual exposure: if the
  apply fails *after* `createDocument` succeeded (transient Yorkie outage / auth
  webhook not yet resolving write on the new docKey), the backend document
  exists but is empty — the item lands in `error` (surfaced via toast +
  retryable), the same create-then-populate window the old single-file flow had.
- **Duplicate documents / orphaned blobs on retry** — retry re-runs the pipeline.
  Mitigation: `getOrCreateDoc` persists `docId` immediately after create so a
  retry reuses the existing document instead of creating a second; PDF likewise
  persists `fileId` after upload so a retry never re-uploads (orphaning) the blob.
- **Regression in single-file importers** — mitigated by keeping
  `pickAndImportXxx` as thin wrappers over the new File-taking cores; existing
  menu behavior unchanged.
