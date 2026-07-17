# Multi-File Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Google-Drive-style drag-and-drop + multi-select upload on the documents list, where each file becomes its matching document type via a hand-rolled upload queue and a fixed bottom-right upload panel.

**Architecture:** A module-singleton upload queue (`upload-queue.ts`) replicates the `slides/zoom-controller.ts` `Set<listener>` + `subscribe` pattern — no state library. A worker loop classifies each file by extension, calls the refactored File-taking importer cores, creates the backend document, and stashes the parsed CRDT doc via the existing `pending-imports` handoff. A `useState + subscribe` hook feeds a greenfield `UploadPanel`. The documents list gains a full-page drop overlay and a multi-select `<input multiple>`.

**Tech Stack:** React 18, TypeScript, Tailwind + shadcn/ui, sonner (terminal summaries only), Vitest, `@wafflebase/{sheets,docs,slides}` importer packages.

## Global Constraints

- No state-management library — hand-roll the store using the `slides/zoom-controller.ts` module-singleton + `Set<listener>` pattern. Verbatim: `const listeners = new Set<() => void>()`; every mutator replaces the `items` array reference then `for (const cb of listeners) cb()`.
- React glue uses `useState + useEffect + subscribe` (match `slides/toolbar/zoom-control.tsx`). Do NOT use `useSyncExternalStore` (zero precedent in the repo).
- Supported kinds only: `.xlsx → sheet`, `.docx → doc`, `.pptx → slides`, `.pdf → pdf`. Everything else → `skipped` (never uploaded). No arbitrary-file storage, no folder recursion, no CSV, no editor-internal multi-image.
- No regression to the existing single-file "New" menu importers — keep `pickAndImportXxx` as thin wrappers over the new File-taking cores.
- Styling: Tailwind utility classes + shadcn semantic tokens (`text-muted-foreground`, `text-destructive`, `bg-background`, `Button variant="ghost"`). No CSS modules.
- Backend limits already enforced: PDF ≤ 50MB, image ≤ 10MB. Surface size failures as a per-row `error`, keep the batch going.
- `workspaceId` is captured at enqueue time and stored on each item (the module has no React context).
- Design doc: `docs/design/documents-multi-file-upload.md`.

---

### Task 1: Refactor importers to accept a File (no regression)

Split each `pickAndImportXxx` into a File-taking core + a thin picker wrapper. The existing "New" menu keeps calling the wrappers unchanged.

**Files:**
- Modify: `packages/frontend/src/app/spreadsheet/xlsx-actions.ts`
- Modify: `packages/frontend/src/app/docs/docx-actions.ts`
- Modify: `packages/frontend/src/app/slides/pptx-actions.ts`
- Test: `packages/frontend/src/app/documents/__tests__/importers.test.ts`

**Interfaces:**
- Produces:
  - `importXlsx(file: File): Promise<{ document: SpreadsheetDocument; fileName: string }>`
  - `importDocx(file: File, onProgress?: (p: { done: number; total: number; fileName: string }) => void): Promise<{ doc: DocsDocument; fileName: string }>`
  - `importPptx(file: File, onProgress?: (p: { done: number; total: number; fileName: string }) => void): Promise<{ document: SlidesDocument; report: ImportReport; fileName: string }>`
  - Existing `pickAndImportXlsx/Docx/Pptx` retained, now delegating to the cores.
- Note: `importPptx` (the new File-taking action) must not collide with the `importPptx` already imported from `@wafflebase/slides` inside `pptx-actions.ts`. Keep the package import as-is; the new exported wrapper is a different, outer function — rename the local action `importPptxFile` if a shadowing conflict arises, and export it under that name. Prefer `importPptxFile` to avoid ambiguity.

- [ ] **Step 1: Write the failing test**

```ts
// packages/frontend/src/app/documents/__tests__/importers.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@wafflebase/sheets", () => ({
  importXlsxWorkbook: vi.fn(async () => [
    { name: "S1", worksheet: {} },
  ]),
}));

import { importXlsx } from "@/app/spreadsheet/xlsx-actions";

describe("importXlsx (File-taking core)", () => {
  it("parses a File into a SpreadsheetDocument without a picker", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "Budget.xlsx");
    const { document, fileName } = await importXlsx(file);
    expect(fileName).toBe("Budget.xlsx");
    expect(document.tabOrder.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test importers`
Expected: FAIL — `importXlsx` is not exported.

- [ ] **Step 3: Add the File-taking core to `xlsx-actions.ts`**

```ts
export async function importXlsx(file: File): Promise<{
  document: SpreadsheetDocument;
  fileName: string;
}> {
  const importedSheets = await importXlsxWorkbook(await file.arrayBuffer());
  return {
    document: createSpreadsheetDocumentFromImportedXlsxSheets(importedSheets),
    fileName: file.name,
  };
}

export async function pickAndImportXlsx(): Promise<{
  document: SpreadsheetDocument;
  fileName: string;
} | null> {
  const file = await pickFile(
    ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  if (!file) return null;
  return importXlsx(file);
}
```

- [ ] **Step 4: Add File-taking cores to `docx-actions.ts` and `pptx-actions.ts`**

```ts
// docx-actions.ts
export async function importDocx(
  file: File,
  onProgress?: (p: { done: number; total: number; fileName: string }) => void,
): Promise<{ doc: DocsDocument; fileName: string }> {
  const buffer = await file.arrayBuffer();
  const doc = await DocxImporter.import(
    buffer,
    docsImageUploader,
    onProgress
      ? (done, total) => onProgress({ done, total, fileName: file.name })
      : undefined,
  );
  return { doc, fileName: file.name };
}

export async function pickAndImportDocx(
  onProgress?: (p: { done: number; total: number; fileName: string }) => void,
): Promise<{ doc: DocsDocument; fileName: string } | null> {
  const file = await pickFile(".docx");
  if (!file) return null;
  return importDocx(file, onProgress);
}
```

```ts
// pptx-actions.ts — the package's importPptx stays imported as-is; expose a
// File-taking action named importPptxFile to avoid shadowing.
export async function importPptxFile(
  file: File,
  onProgress?: (p: { done: number; total: number; fileName: string }) => void,
): Promise<{ document: SlidesDocument; report: ImportReport; fileName: string }> {
  const buffer = await file.arrayBuffer();
  const { document, report } = await importPptx(buffer, {
    uploadImage: slidesImageUploader,
    onProgress: onProgress
      ? (done, total) => onProgress({ done, total, fileName: file.name })
      : undefined,
  });
  return { document, report, fileName: file.name };
}

export async function pickAndImportPptx(
  onProgress?: (p: { done: number; total: number; fileName: string }) => void,
): Promise<{ document: SlidesDocument; report: ImportReport; fileName: string } | null> {
  const file = await pickFile(".pptx");
  if (!file) return null;
  return importPptxFile(file, onProgress);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @wafflebase/frontend test importers`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/app/spreadsheet/xlsx-actions.ts \
        packages/frontend/src/app/docs/docx-actions.ts \
        packages/frontend/src/app/slides/pptx-actions.ts \
        packages/frontend/src/app/documents/__tests__/importers.test.ts
git commit -m "Split importers into File-taking cores for the upload queue"
```

---

### Task 2: Extension → kind classifier

Pure function mapping a filename to a supported `UploadKind` or `null` (skipped). Isolated so it is trivially testable and reused by both the queue and the panel icons.

**Files:**
- Create: `packages/frontend/src/app/documents/upload-kind.ts`
- Test: `packages/frontend/src/app/documents/__tests__/upload-kind.test.ts`

**Interfaces:**
- Produces:
  - `type UploadKind = "sheet" | "doc" | "slides" | "pdf"`
  - `classifyUploadKind(fileName: string): UploadKind | null`
  - `SKIP_REASON = "Unsupported file type"` (exported const)

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/upload-kind.test.ts
import { describe, it, expect } from "vitest";
import { classifyUploadKind } from "@/app/documents/upload-kind";

describe("classifyUploadKind", () => {
  it("maps supported extensions case-insensitively", () => {
    expect(classifyUploadKind("Budget.XLSX")).toBe("sheet");
    expect(classifyUploadKind("notes.docx")).toBe("doc");
    expect(classifyUploadKind("deck.pptx")).toBe("slides");
    expect(classifyUploadKind("report.pdf")).toBe("pdf");
  });
  it("returns null for unsupported types", () => {
    expect(classifyUploadKind("photo.png")).toBeNull();
    expect(classifyUploadKind("archive.zip")).toBeNull();
    expect(classifyUploadKind("noext")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test upload-kind`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `upload-kind.ts`**

```ts
export type UploadKind = "sheet" | "doc" | "slides" | "pdf";

export const SKIP_REASON = "Unsupported file type";

const EXT_TO_KIND: Record<string, UploadKind> = {
  xlsx: "sheet",
  docx: "doc",
  pptx: "slides",
  pdf: "pdf",
};

export function classifyUploadKind(fileName: string): UploadKind | null {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = fileName.slice(dot + 1).toLowerCase();
  return EXT_TO_KIND[ext] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test upload-kind`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/documents/upload-kind.ts \
        packages/frontend/src/app/documents/__tests__/upload-kind.test.ts
git commit -m "Add extension-to-kind classifier for uploads"
```

---

### Task 3: Upload queue store (state + mutators, no worker yet)

Module singleton holding items + listeners. This task covers pure state transitions; the async worker loop is Task 4 so the store stays unit-testable in isolation.

**Files:**
- Create: `packages/frontend/src/app/documents/upload-queue.ts`
- Test: `packages/frontend/src/app/documents/__tests__/upload-queue.test.ts`

**Interfaces:**
- Consumes: `classifyUploadKind`, `SKIP_REASON`, `UploadKind` from Task 2.
- Produces:
  - `type UploadStatus = "pending" | "parsing" | "uploading" | "done" | "error" | "skipped"`
  - `interface UploadItem { id: string; fileName: string; kind: UploadKind | null; workspaceId?: string; status: UploadStatus; done: number; total: number; docId?: string; docPath?: string; reason?: string }`
  - `getSnapshot(): readonly UploadItem[]`
  - `subscribe(cb: () => void): () => void`
  - `enqueue(files: File[], workspaceId?: string): UploadItem[]` — creates items (skipped ones get `status:"skipped"` immediately), returns the created items. (Does NOT start work — Task 4 wires the runner.)
  - `patchItem(id: string, patch: Partial<UploadItem>): void`
  - `removeItem(id: string): void`
  - `clearFinished(): void`
  - Internal (exported for the worker in Task 4): `nextPendingId(): string | undefined`, `activeCount(): number`
- Note on ids: `Date.now()`/`Math.random()` are fine in app code (this restriction only applies to Workflow scripts). Use a module-level incrementing counter `let seq = 0; const id = \`u\${++seq}\`` for deterministic tests.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/upload-queue.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as q from "@/app/documents/upload-queue";

function file(name: string): File {
  return new File([new Uint8Array([1])], name);
}

describe("upload-queue store", () => {
  beforeEach(() => q.__resetForTest());

  it("enqueues supported files as pending and unsupported as skipped", () => {
    const items = q.enqueue([file("a.xlsx"), file("b.png")], "ws1");
    expect(items.map((i) => i.status)).toEqual(["pending", "skipped"]);
    expect(items[0].kind).toBe("sheet");
    expect(items[0].workspaceId).toBe("ws1");
    expect(items[1].reason).toBe("Unsupported file type");
  });

  it("emits to subscribers and changes snapshot identity on mutation", () => {
    const cb = vi.fn();
    const unsub = q.subscribe(cb);
    const before = q.getSnapshot();
    q.enqueue([file("a.docx")]);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(q.getSnapshot()).not.toBe(before);
    unsub();
    q.enqueue([file("c.pdf")]);
    expect(cb).toHaveBeenCalledTimes(1); // unsubscribed
  });

  it("patchItem updates status/progress and clearFinished prunes terminals", () => {
    const [item] = q.enqueue([file("a.pptx")]);
    q.patchItem(item.id, { status: "uploading", done: 2, total: 5 });
    expect(q.getSnapshot()[0]).toMatchObject({ status: "uploading", done: 2 });
    q.patchItem(item.id, { status: "done" });
    q.clearFinished();
    expect(q.getSnapshot()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test upload-queue`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store**

```ts
// packages/frontend/src/app/documents/upload-queue.ts
import { classifyUploadKind, SKIP_REASON, type UploadKind } from "./upload-kind";

export type UploadStatus =
  | "pending" | "parsing" | "uploading" | "done" | "error" | "skipped";

export interface UploadItem {
  id: string;
  file?: File;            // retained for the worker; omitted from public reasoning
  fileName: string;
  kind: UploadKind | null;
  workspaceId?: string;
  status: UploadStatus;
  done: number;
  total: number;
  docId?: string;
  docPath?: string;
  reason?: string;
}

let seq = 0;
let items: UploadItem[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const cb of listeners) cb();
}

function replace(next: UploadItem[]) {
  items = next;
  emit();
}

export function getSnapshot(): readonly UploadItem[] {
  return items;
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function enqueue(files: File[], workspaceId?: string): UploadItem[] {
  const created: UploadItem[] = files.map((file) => {
    const kind = classifyUploadKind(file.name);
    return {
      id: `u${++seq}`,
      file,
      fileName: file.name,
      kind,
      workspaceId,
      status: kind ? "pending" : "skipped",
      done: 0,
      total: 0,
      reason: kind ? undefined : SKIP_REASON,
    };
  });
  replace([...items, ...created]);
  return created;
}

export function patchItem(id: string, patch: Partial<UploadItem>): void {
  replace(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
}

export function removeItem(id: string): void {
  replace(items.filter((it) => it.id !== id));
}

export function clearFinished(): void {
  replace(
    items.filter(
      (it) => it.status !== "done" && it.status !== "skipped",
    ),
  );
}

export function nextPendingId(): string | undefined {
  return items.find((it) => it.status === "pending")?.id;
}

export function activeCount(): number {
  return items.filter(
    (it) => it.status === "parsing" || it.status === "uploading",
  ).length;
}

/** Test-only reset of module state. */
export function __resetForTest(): void {
  items = [];
  listeners.clear();
  seq = 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test upload-queue`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/documents/upload-queue.ts \
        packages/frontend/src/app/documents/__tests__/upload-queue.test.ts
git commit -m "Add upload-queue store: items, listeners, mutators"
```

---

### Task 4: Worker loop + per-item pipeline

Drive pending items through parse/upload → create document → stash → done, with a concurrency cap. Dependencies (importers, create-doc, pending-imports, uploadPdf, getDocumentPath) are injected so the loop is testable without network.

**Files:**
- Modify: `packages/frontend/src/app/documents/upload-queue.ts`
- Test: `packages/frontend/src/app/documents/__tests__/upload-queue-worker.test.ts`

**Interfaces:**
- Consumes: store mutators from Task 3; importer cores from Task 1; `uploadPdf` (`@/api/files`), `createDocument`/`createWorkspaceDocument` (`@/api/documents`, `@/api/workspaces`), `getDocumentPath` (`@/app/documents/...`), `setPendingImport` (docs), `setPendingImport as setPendingPptxImport` (slides), `setPendingImport as setPendingXlsxImport` (spreadsheet).
- Produces:
  - `interface UploadDeps { … }` — injected function bundle (see Step 3), defaulted to the real modules.
  - `startUploads(onItemDone?: (item: UploadItem) => void, deps?: Partial<UploadDeps>): void` — kicks the runner; called by `enqueue` callers or wired inside `enqueue`.
  - `retry(id: string): void` — resets a failed item to `pending` (or resumes from `docId` if the document was already created) and re-runs the loop.
- Concurrency: `const MAX_CONCURRENCY = 2` (parsing is main-thread; keep low). Runner starts up to `MAX_CONCURRENCY - activeCount()` items each tick.
- Duplicate-doc guard: if an item already has `docId` when retried, skip `createDocument` and resume at the stash/finish step.

- [ ] **Step 1: Write the failing test (injected deps, no network)**

```ts
// __tests__/upload-queue-worker.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as q from "@/app/documents/upload-queue";

function file(name: string): File {
  return new File([new Uint8Array([1])], name);
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("upload-queue worker", () => {
  beforeEach(() => q.__resetForTest());

  it("processes a mixed batch to done/skipped", async () => {
    const deps = {
      importXlsx: vi.fn(async (f: File) => ({ document: { tabOrder: ["t"] }, fileName: f.name })),
      importDocx: vi.fn(async (f: File) => ({ doc: {}, fileName: f.name })),
      importPptxFile: vi.fn(async (f: File) => ({ document: {}, report: { summary: () => "" }, fileName: f.name })),
      uploadPdf: vi.fn(async () => ({ id: "file1" })),
      createDoc: vi.fn(async (_ws, p) => ({ id: "d" + p.title, title: p.title, type: p.type })),
      getDocumentPath: (d: { id: string }) => `/path/${d.id}`,
      stashSheet: vi.fn(),
      stashDoc: vi.fn(),
      stashSlides: vi.fn(),
    };
    q.enqueue([file("a.xlsx"), file("b.png"), file("c.pdf")], "ws1");
    q.startUploads(undefined, deps);
    await flush(); await flush(); await flush();

    const snap = q.getSnapshot();
    expect(snap.find((i) => i.fileName === "a.xlsx")?.status).toBe("done");
    expect(snap.find((i) => i.fileName === "c.pdf")?.status).toBe("done");
    expect(snap.find((i) => i.fileName === "b.png")?.status).toBe("skipped");
    expect(deps.createDoc).toHaveBeenCalledTimes(2); // xlsx + pdf, not png
  });

  it("marks an item error when its importer throws and keeps others going", async () => {
    const deps = {
      importDocx: vi.fn(async () => { throw new Error("corrupt"); }),
      importXlsx: vi.fn(async (f: File) => ({ document: { tabOrder: ["t"] }, fileName: f.name })),
      importPptxFile: vi.fn(),
      uploadPdf: vi.fn(),
      createDoc: vi.fn(async (_ws, p) => ({ id: "d", title: p.title, type: p.type })),
      getDocumentPath: () => "/p",
      stashSheet: vi.fn(), stashDoc: vi.fn(), stashSlides: vi.fn(),
    };
    q.enqueue([file("bad.docx"), file("ok.xlsx")], "ws1");
    q.startUploads(undefined, deps);
    await flush(); await flush(); await flush();

    const snap = q.getSnapshot();
    expect(snap.find((i) => i.fileName === "bad.docx")?.status).toBe("error");
    expect(snap.find((i) => i.fileName === "bad.docx")?.reason).toContain("corrupt");
    expect(snap.find((i) => i.fileName === "ok.xlsx")?.status).toBe("done");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test upload-queue-worker`
Expected: FAIL — `startUploads` not exported.

- [ ] **Step 3: Implement the worker in `upload-queue.ts`**

```ts
import { importXlsx } from "@/app/spreadsheet/xlsx-actions";
import { importDocx } from "@/app/docs/docx-actions";
import { importPptxFile } from "@/app/slides/pptx-actions";
import { uploadPdf } from "@/api/files";
import { createDocument, getDocumentPath } from "@/api/documents";
import { createWorkspaceDocument } from "@/api/workspaces";
import { setPendingImport as stashDocDefault } from "@/app/docs/pending-imports";
import { setPendingImport as stashSlidesDefault } from "@/app/slides/pending-imports";
import { setPendingImport as stashSheetDefault } from "@/app/spreadsheet/pending-imports";
import type { Document, DocumentType } from "@/types/documents";

const MAX_CONCURRENCY = 2;

export interface UploadDeps {
  importXlsx: typeof importXlsx;
  importDocx: typeof importDocx;
  importPptxFile: typeof importPptxFile;
  uploadPdf: typeof uploadPdf;
  createDoc: (
    workspaceId: string | undefined,
    payload: { title: string; type: DocumentType; fileId?: string },
  ) => Promise<Document>;
  getDocumentPath: (doc: Document) => string;
  stashSheet: typeof stashSheetDefault;
  stashDoc: typeof stashDocDefault;
  stashSlides: typeof stashSlidesDefault;
}

const defaultDeps: UploadDeps = {
  importXlsx,
  importDocx,
  importPptxFile,
  uploadPdf,
  createDoc: (ws, payload) =>
    ws ? createWorkspaceDocument(ws, payload) : createDocument(payload),
  getDocumentPath,
  stashSheet: stashSheetDefault,
  stashDoc: stashDocDefault,
  stashSlides: stashSlidesDefault,
};

let activeDeps: UploadDeps = defaultDeps;
let onItemDoneCb: ((item: UploadItem) => void) | undefined;

function stripExt(name: string, ext: string, fallback: string): string {
  return name.replace(new RegExp(`\\.${ext}$`, "i"), "") || fallback;
}

async function runItem(item: UploadItem): Promise<void> {
  const d = activeDeps;
  const file = item.file!;
  try {
    if (item.kind === "sheet") {
      patchItem(item.id, { status: "parsing" });
      const { document } = await d.importXlsx(file);
      const title = stripExt(item.fileName, "xlsx", "Imported Sheet");
      const created = await d.createDoc(item.workspaceId, { title, type: "sheet" });
      d.stashSheet(String(created.id), document);
      finish(item.id, created);
    } else if (item.kind === "doc") {
      patchItem(item.id, { status: "parsing" });
      const { doc } = await d.importDocx(file, ({ done, total }) =>
        patchItem(item.id, { status: "uploading", done, total }),
      );
      const title = stripExt(item.fileName, "docx", "Imported Document");
      const created = await d.createDoc(item.workspaceId, { title, type: "doc" });
      d.stashDoc(String(created.id), doc);
      finish(item.id, created);
    } else if (item.kind === "slides") {
      patchItem(item.id, { status: "parsing" });
      const { document } = await d.importPptxFile(file, ({ done, total }) =>
        patchItem(item.id, { status: "uploading", done, total }),
      );
      const title = stripExt(item.fileName, "pptx", "Imported Presentation");
      const created = await d.createDoc(item.workspaceId, { title, type: "slides" });
      d.stashSlides(String(created.id), document);
      finish(item.id, created);
    } else if (item.kind === "pdf") {
      patchItem(item.id, { status: "uploading" });
      const { id: fileId } = await d.uploadPdf(file);
      const title = stripExt(item.fileName, "pdf", "Untitled PDF");
      const created = await d.createDoc(item.workspaceId, { title, type: "pdf", fileId });
      finish(item.id, created);
    }
  } catch (err) {
    patchItem(item.id, {
      status: "error",
      reason: err instanceof Error ? err.message : "Upload failed",
    });
  } finally {
    pump();
  }
}

function finish(id: string, created: Document): void {
  patchItem(id, {
    status: "done",
    docId: String(created.id),
    docPath: activeDeps.getDocumentPath(created),
  });
  const item = items.find((it) => it.id === id);
  if (item && onItemDoneCb) onItemDoneCb(item);
}

function pump(): void {
  while (activeCount() < MAX_CONCURRENCY) {
    const id = nextPendingId();
    if (!id) return;
    const item = items.find((it) => it.id === id);
    if (!item) return;
    patchItem(id, { status: "parsing" }); // claim the slot before await
    void runItem(item);
  }
}

export function startUploads(
  onItemDone?: (item: UploadItem) => void,
  deps?: Partial<UploadDeps>,
): void {
  onItemDoneCb = onItemDone ?? onItemDoneCb;
  activeDeps = { ...defaultDeps, ...deps };
  pump();
}

export function retry(id: string): void {
  patchItem(id, { status: "pending", reason: undefined, done: 0, total: 0 });
  pump();
}
```

Add `activeDeps`/`onItemDoneCb`/`seq` resets to `__resetForTest`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @wafflebase/frontend test upload-queue-worker`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/app/documents/upload-queue.ts \
        packages/frontend/src/app/documents/__tests__/upload-queue-worker.test.ts
git commit -m "Add upload-queue worker loop with concurrency cap"
```

---

### Task 5: React hook + Upload panel

Subscribe to the store and render the fixed bottom-right panel.

**Files:**
- Create: `packages/frontend/src/app/documents/use-upload-queue.ts`
- Create: `packages/frontend/src/app/documents/upload-panel.tsx`
- Test: `packages/frontend/src/app/documents/__tests__/upload-panel.test.tsx`

**Interfaces:**
- Consumes: `getSnapshot`, `subscribe`, `retry`, `removeItem`, `clearFinished`, `UploadItem` from the store.
- Produces:
  - `useUploadQueue(): readonly UploadItem[]`
  - `UploadPanel: React.FC` (self-contained; reads the hook, renders null when empty).

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/upload-panel.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import * as q from "@/app/documents/upload-queue";
import { UploadPanel } from "@/app/documents/upload-panel";

describe("UploadPanel", () => {
  beforeEach(() => q.__resetForTest());

  it("renders nothing when the queue is empty", () => {
    const { container } = render(<MemoryRouter><UploadPanel /></MemoryRouter>);
    expect(container.firstChild).toBeNull();
  });

  it("shows a row per file with its status", () => {
    q.enqueue([new File([new Uint8Array([1])], "deck.pptx"),
               new File([new Uint8Array([1])], "photo.png")]);
    render(<MemoryRouter><UploadPanel /></MemoryRouter>);
    expect(screen.getByText("deck.pptx")).toBeInTheDocument();
    expect(screen.getByText("photo.png")).toBeInTheDocument();
    expect(screen.getByText(/unsupported/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test upload-panel`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the hook**

```ts
// use-upload-queue.ts — matches slides/toolbar/zoom-control.tsx pattern
import { useEffect, useState } from "react";
import { getSnapshot, subscribe, type UploadItem } from "./upload-queue";

export function useUploadQueue(): readonly UploadItem[] {
  const [items, setItems] = useState<readonly UploadItem[]>(getSnapshot());
  useEffect(() => subscribe(() => setItems(getSnapshot())), []);
  return items;
}
```

- [ ] **Step 4: Implement the panel**

```tsx
// upload-panel.tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Loader2, RotateCw, X, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUploadQueue } from "./use-upload-queue";
import { retry, removeItem, clearFinished, type UploadItem } from "./upload-queue";

function StatusCell({ item }: { item: UploadItem }) {
  if (item.status === "done")
    return item.docPath ? (
      <Link to={item.docPath} className="text-xs text-primary hover:underline">Open</Link>
    ) : <CheckCircle2 className="h-4 w-4 text-primary" />;
  if (item.status === "skipped")
    return <span className="text-xs text-muted-foreground">Unsupported</span>;
  if (item.status === "error")
    return (
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => retry(item.id)}
              title={item.reason}>
        <RotateCw className="h-3.5 w-3.5 text-destructive" />
      </Button>
    );
  const label = item.total > 0 ? `${Math.min(item.done, item.total)}/${item.total}` : "";
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />{label}
    </span>
  );
}

export function UploadPanel() {
  const items = useUploadQueue();
  const [collapsed, setCollapsed] = useState(false);
  if (items.length === 0) return null;

  const active = items.filter(
    (i) => i.status === "pending" || i.status === "parsing" || i.status === "uploading",
  ).length;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border bg-background shadow-lg">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-medium">
          {active > 0 ? `Uploading ${active} item${active > 1 ? "s" : ""}…` : "Uploads"}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-6 w-6"
                  onClick={() => setCollapsed((c) => !c)}>
            {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={clearFinished}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {!collapsed && (
        <ul className="max-h-72 overflow-y-auto py-1">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2 px-3 py-1.5">
              <span className="flex-1 truncate text-sm" title={item.fileName}>{item.fileName}</span>
              <StatusCell item={item} />
              {(item.status === "done" || item.status === "skipped" || item.status === "error") && (
                <Button variant="ghost" size="icon" className="h-6 w-6"
                        onClick={() => removeItem(item.id)}>
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @wafflebase/frontend test upload-panel`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/app/documents/use-upload-queue.ts \
        packages/frontend/src/app/documents/upload-panel.tsx \
        packages/frontend/src/app/documents/__tests__/upload-panel.test.tsx
git commit -m "Add useUploadQueue hook and UploadPanel"
```

---

### Task 6: Drop zone + multi-select wiring in the documents list

Mount the panel, add a full-page drag overlay, add multi-select to the "New" menu import items, refresh the list on completion, and remove the old single-file progress toast.

**Files:**
- Modify: `packages/frontend/src/app/documents/document-list.tsx`
- Create: `packages/frontend/src/app/documents/pick-files.ts` (multi-select picker)
- Test: `packages/frontend/src/app/documents/__tests__/pick-files.test.ts`

**Interfaces:**
- Consumes: `enqueue`, `startUploads` from the store; `useQueryClient` (already in file); `workspaceId` prop (already in scope).
- Produces: `pickFiles(accept: string): Promise<File[]>` (multi-select variant of `pickFile`).

- [ ] **Step 1: Write the failing test for `pickFiles`**

```ts
// __tests__/pick-files.test.ts
import { describe, it, expect, vi } from "vitest";
import { pickFiles } from "@/app/documents/pick-files";

describe("pickFiles", () => {
  it("resolves the selected files and sets multiple on the input", async () => {
    const clicks: HTMLInputElement[] = [];
    const orig = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      clicks.push(this as HTMLInputElement);
    };
    const p = pickFiles(".xlsx,.pdf");
    const input = clicks[0];
    expect(input.multiple).toBe(true);
    Object.defineProperty(input, "files", {
      value: [new File([new Uint8Array([1])], "a.xlsx")],
    });
    input.onchange?.(new Event("change"));
    const files = await p;
    expect(files.map((f) => f.name)).toEqual(["a.xlsx"]);
    HTMLInputElement.prototype.click = orig;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @wafflebase/frontend test pick-files`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `pickFiles` (mirror `pickFile`, `multiple`, return array)**

```ts
// pick-files.ts
export function pickFiles(accept: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = true;
    input.style.display = "none";
    let settled = false;
    input.onchange = () => {
      settled = true;
      const files = input.files ? Array.from(input.files) : [];
      cleanup();
      resolve(files);
    };
    const onFocus = () => {
      window.removeEventListener("focus", onFocus);
      setTimeout(() => {
        if (!settled) { cleanup(); resolve([]); }
      }, 300);
    };
    window.addEventListener("focus", onFocus);
    const cleanup = () => {
      if (input.parentNode) input.parentNode.removeChild(input);
    };
    document.body.appendChild(input);
    input.click();
  });
}
```

- [ ] **Step 4: Run the pick-files test to verify it passes**

Run: `pnpm --filter @wafflebase/frontend test pick-files`
Expected: PASS.

- [ ] **Step 5: Wire the documents list**

In `document-list.tsx`:

1. Import: `import { UploadPanel } from "./upload-panel"; import { enqueue, startUploads } from "./upload-queue"; import { pickFiles } from "./pick-files"; import { UPLOAD_ACCEPT } from "./upload-kind";` and add `export const UPLOAD_ACCEPT = ".xlsx,.docx,.pptx,.pdf";` to `upload-kind.ts`.
2. Add an `onUploadFiles` helper inside the component:

```tsx
const startBatch = (files: File[]) => {
  if (files.length === 0) return;
  enqueue(files, workspaceId);
  startUploads((item) => {
    // refresh list when a doc lands
    queryClient.invalidateQueries({ queryKey: ["documents"] });
    if (workspaceId) {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "documents"],
      });
    }
    void item;
  });
};
```

3. Replace the "New" menu single-file import handlers' pick step so the import items call `startBatch(await pickFiles(UPLOAD_ACCEPT))` for a unified multi-select "Import files…" entry. Keep the existing type-specific menu items if desired, but route them through `pickFiles` filtered to that type (e.g. `pickFiles(".xlsx")`). Remove `updateImportToast`, `importing` gating, and the per-type `handleImport*`/`handleUploadPdf` bodies now that the queue owns progress. (Retain the create-blank-document handlers untouched.)
4. Add a full-page drop overlay. Near the component root JSX:

```tsx
const [dragging, setDragging] = useState(false);

<div
  onDragEnter={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
  onDragOver={(e) => { if (dragging) e.preventDefault(); }}
  onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
  onDrop={(e) => {
    e.preventDefault();
    setDragging(false);
    startBatch(Array.from(e.dataTransfer.files));
  }}
>
  {/* existing list content */}
  {dragging && (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/5">
      <span className="text-lg font-medium text-primary">Drop files to upload</span>
    </div>
  )}
</div>
```

Ensure the wrapping element is `relative` so the overlay's `absolute inset-0` covers the list.
5. Render `<UploadPanel />` once at the component root (outside the list container so it stays fixed).

- [ ] **Step 6: Manual verification in dev**

```bash
docker compose up -d
pnpm dev
```

In the documents list: drag a batch of `.xlsx` + `.docx` + `.pptx` + `.pdf` + one `.png`. Confirm each supported file becomes the right document type, the `.png` shows "Unsupported", the panel shows progress and "Open" links, the list refreshes, and a forced failure (drop a corrupt `.docx`) marks only that row `error` with a working retry.

- [ ] **Step 7: Run the full pre-commit gate**

Run: `pnpm verify:fast`
Expected: lint + unit tests PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/src/app/documents/document-list.tsx \
        packages/frontend/src/app/documents/pick-files.ts \
        packages/frontend/src/app/documents/upload-kind.ts \
        packages/frontend/src/app/documents/__tests__/pick-files.test.ts
git commit -m "Wire drop zone + multi-select upload into the documents list"
```

---

### Task 7: Self-review, docs, and PR

- [ ] **Step 1: Dispatch a code review over the branch diff**

Use `/code-review` (or `superpowers:requesting-code-review`) against the full branch diff. Apply blocking findings; note non-blocking ones as known limitations.

- [ ] **Step 2: Capture lessons + update the todo review section**

Fill `docs/tasks/active/20260717-multi-file-upload-todo.md` "Review" section and write `docs/tasks/active/20260717-multi-file-upload-lessons.md`.

- [ ] **Step 3: Rebase and open the PR**

```bash
git fetch && git rebase origin/main
```

PR title ≤70 chars, body = Summary + Test plan.

## Self-Review (plan vs. spec)

- **Spec coverage:** drop zone (Task 6) ✓; multi-select (Task 6) ✓; upload panel with per-file progress/retry (Task 5) ✓; unsupported→skipped (Task 2/3) ✓; hand-rolled store, no library (Task 3) ✓; `useState+subscribe` hook, not `useSyncExternalStore` (Task 5) ✓; importer no-regression refactor (Task 1) ✓; workspaceId captured at enqueue (Task 3) ✓; concurrency cap + main-thread-freeze mitigation (Task 4) ✓; duplicate-doc-on-retry guard (Task 4) ✓; size-limit surfaced as per-row error (Task 4 error path) ✓.
- **Type consistency:** `UploadItem`/`UploadStatus`/`UploadKind` defined once (Tasks 2–3) and reused verbatim in Tasks 4–6; `importPptxFile` (not `importPptx`) used consistently in Tasks 1 and 4 to avoid the package-import shadow; `createDoc` dep signature matches `createDocument`/`createWorkspaceDocument`.
- **Placeholders:** none — every code step is complete.
```
