import { classifyUploadKind, SKIP_REASON, type UploadKind } from "./upload-kind";
import { getDocumentPath as getDocumentPathDefault } from "./document-list-utils";
import { importXlsx } from "@/app/spreadsheet/xlsx-actions";
import { importDocx } from "@/app/docs/docx-actions";
import { importPptxFile } from "@/app/slides/pptx-actions";
import { uploadPdf } from "@/api/files";
import { createDocument } from "@/api/documents";
import { createWorkspaceDocument } from "@/api/workspaces";
import { applyImportedContent as applyImportedContentDefault } from "./apply-imported-content";
import type { Document, DocumentType } from "@/types/documents";

export type UploadStatus =
  | "pending"
  | "parsing"
  | "uploading"
  | "done"
  | "error"
  | "skipped";

export interface UploadItem {
  id: string;
  file?: File; // retained for the worker; omitted from public reasoning
  fileName: string;
  kind: UploadKind | null;
  workspaceId?: string;
  status: UploadStatus;
  done: number;
  total: number;
  docId?: string;
  docPath?: string;
  /** PDF: the uploaded blob id, persisted so a retry never re-uploads it. */
  fileId?: string;
  reason?: string;
  /** Non-fatal note surfaced on success (e.g. lossy PPTX import fallbacks). */
  warning?: string;
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
      // Skipped items are never processed, so don't pin their File blob in
      // memory — only supported items need it for the worker.
      file: kind ? file : undefined,
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
    items.filter((it) => it.status !== "done" && it.status !== "skipped"),
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
  activeDeps = defaultDeps;
  onItemSettledCb = undefined;
}

// ---------------------------------------------------------------------------
// Worker: drives pending items through parse/upload -> create document ->
// stash -> done, with a concurrency cap and per-item error isolation.
// ---------------------------------------------------------------------------

const MAX_CONCURRENCY = 2;

/** Minimal ref to a created document, enough to route + stash. */
interface DocRef {
  id: string;
  type: DocumentType;
}

export interface UploadDeps {
  importXlsx: typeof importXlsx;
  importDocx: typeof importDocx;
  importPptxFile: typeof importPptxFile;
  uploadPdf: typeof uploadPdf;
  createDoc: (
    workspaceId: string | undefined,
    payload: { title: string; type: DocumentType; fileId?: string },
  ) => Promise<Document>;
  getDocumentPath: (doc: DocRef) => string;
  applyContent: typeof applyImportedContentDefault;
}

const defaultDeps: UploadDeps = {
  importXlsx,
  importDocx,
  importPptxFile,
  uploadPdf,
  createDoc: (ws, payload) =>
    ws ? createWorkspaceDocument(ws, payload) : createDocument(payload),
  getDocumentPath: getDocumentPathDefault,
  applyContent: applyImportedContentDefault,
};

let activeDeps: UploadDeps = defaultDeps;
// Fired once per item when it reaches a terminal state (done or error) so the
// host can refresh the list, surface a failure, or warn about a lossy import.
let onItemSettledCb: ((item: UploadItem) => void) | undefined;

function stripExt(name: string, ext: string, fallback: string): string {
  return name.replace(new RegExp(`\\.${ext}$`, "i"), "") || fallback;
}

/**
 * Resolves the document to stash/finish against. If the item already has a
 * `docId` (a prior attempt on this same item created the document but failed
 * on a later step, e.g. stash), reuse it instead of calling `createDoc`
 * again — retrying an item must never create a second document.
 */
async function getOrCreateDoc(
  item: UploadItem,
  payload: { title: string; type: DocumentType; fileId?: string },
): Promise<DocRef> {
  if (item.docId) {
    return { id: item.docId, type: payload.type };
  }
  const created = await activeDeps.createDoc(item.workspaceId, payload);
  const id = String(created.id);
  // Persist the docId as soon as the document exists, *before* the stash
  // step runs. If stash throws, the item lands in "error" with docId
  // already set, so a subsequent retry() will skip createDoc via the
  // check above instead of creating a duplicate document.
  patchItem(item.id, { docId: id });
  return { id, type: created.type };
}

function finish(id: string, created: DocRef, warning?: string): void {
  patchItem(id, {
    status: "done",
    docId: created.id,
    docPath: activeDeps.getDocumentPath(created),
    warning,
    // Release the retained File once the upload has succeeded — only
    // error items need to keep it around for retry().
    file: undefined,
  });
  settle(id);
}

/** Notify the host that an item reached a terminal (done/error) state. */
function settle(id: string): void {
  const item = items.find((it) => it.id === id);
  if (item && onItemSettledCb) onItemSettledCb(item);
}

async function runItem(item: UploadItem): Promise<void> {
  const d = activeDeps;
  const file = item.file!;
  try {
    if (item.kind === "sheet") {
      patchItem(item.id, { status: "parsing" });
      const { document } = await d.importXlsx(file);
      const title = stripExt(item.fileName, "xlsx", "Imported Sheet");
      const created = await getOrCreateDoc(item, { title, type: "sheet" });
      // Persist the parsed content into the Yorkie doc now (see
      // apply-imported-content.ts) so "done" means it is actually saved —
      // not merely stashed in memory awaiting an editor mount.
      patchItem(item.id, { status: "uploading" });
      await d.applyContent(created.id, { type: "sheet", document });
      finish(item.id, created);
    } else if (item.kind === "doc") {
      patchItem(item.id, { status: "parsing" });
      const { doc } = await d.importDocx(file, ({ done, total }) =>
        patchItem(item.id, { status: "uploading", done, total }),
      );
      const title = stripExt(item.fileName, "docx", "Imported Document");
      const created = await getOrCreateDoc(item, { title, type: "doc" });
      patchItem(item.id, { status: "uploading" });
      await d.applyContent(created.id, { type: "doc", document: doc });
      finish(item.id, created);
    } else if (item.kind === "slides") {
      patchItem(item.id, { status: "parsing" });
      const { document, report } = await d.importPptxFile(
        file,
        ({ done, total }) =>
          patchItem(item.id, { status: "uploading", done, total }),
      );
      const title = stripExt(item.fileName, "pptx", "Imported Presentation");
      const created = await getOrCreateDoc(item, { title, type: "slides" });
      patchItem(item.id, { status: "uploading" });
      await d.applyContent(created.id, { type: "slides", document });
      // Surface lossy-conversion fallbacks the same way the old flow did.
      const summary = report.summary();
      const warning =
        summary && summary !== "Imported with no fallbacks." ? summary : undefined;
      finish(item.id, created, warning);
    } else if (item.kind === "pdf") {
      patchItem(item.id, { status: "uploading" });
      const title = stripExt(item.fileName, "pdf", "Untitled PDF");
      // Upload the blob at most once per item: persist the returned fileId
      // immediately so a retry whose earlier failure was in createDoc reuses
      // the blob instead of orphaning it with a second upload.
      let fileId = item.fileId;
      if (!fileId) {
        ({ id: fileId } = await d.uploadPdf(file));
        patchItem(item.id, { fileId });
      }
      const created = await getOrCreateDoc(item, { title, type: "pdf", fileId });
      finish(item.id, created);
    }
  } catch (err) {
    patchItem(item.id, {
      status: "error",
      reason: err instanceof Error ? err.message : "Upload failed",
    });
    settle(item.id);
  } finally {
    pump();
  }
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
  onItemSettled?: (item: UploadItem) => void,
  deps?: Partial<UploadDeps>,
): void {
  onItemSettledCb = onItemSettled ?? onItemSettledCb;
  activeDeps = { ...defaultDeps, ...deps };
  pump();
}

export function retry(id: string): void {
  patchItem(id, { status: "pending", reason: undefined, done: 0, total: 0 });
  pump();
}
