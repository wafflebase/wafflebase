import { classifyUploadKind, SKIP_REASON, type UploadKind } from "./upload-kind";
import { getDocumentPath as getDocumentPathDefault } from "./document-list-utils";
import { importXlsx } from "@/app/spreadsheet/xlsx-actions";
import { importDocx } from "@/app/docs/docx-actions";
import { importPptxFile } from "@/app/slides/pptx-actions";
import { uploadPdf } from "@/api/files";
import { createDocument } from "@/api/documents";
import { createWorkspaceDocument } from "@/api/workspaces";
import { setPendingImport as stashDocDefault } from "@/app/docs/pending-imports";
import { setPendingImport as stashSlidesDefault } from "@/app/slides/pending-imports";
import { setPendingImport as stashSheetDefault } from "@/app/spreadsheet/pending-imports";
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
  onItemDoneCb = undefined;
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
  getDocumentPath: getDocumentPathDefault,
  stashSheet: stashSheetDefault,
  stashDoc: stashDocDefault,
  stashSlides: stashSlidesDefault,
};

let activeDeps: UploadDeps = defaultDeps;
let onItemDoneCb: ((item: UploadItem) => void) | undefined;

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

function finish(id: string, created: DocRef): void {
  patchItem(id, {
    status: "done",
    docId: created.id,
    docPath: activeDeps.getDocumentPath(created),
    // Release the retained File once the upload has succeeded — only
    // error items need to keep it around for retry().
    file: undefined,
  });
  const item = items.find((it) => it.id === id);
  if (item && onItemDoneCb) onItemDoneCb(item);
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
      d.stashSheet(created.id, document);
      finish(item.id, created);
    } else if (item.kind === "doc") {
      patchItem(item.id, { status: "parsing" });
      const { doc } = await d.importDocx(file, ({ done, total }) =>
        patchItem(item.id, { status: "uploading", done, total }),
      );
      const title = stripExt(item.fileName, "docx", "Imported Document");
      const created = await getOrCreateDoc(item, { title, type: "doc" });
      d.stashDoc(created.id, doc);
      finish(item.id, created);
    } else if (item.kind === "slides") {
      patchItem(item.id, { status: "parsing" });
      const { document } = await d.importPptxFile(file, ({ done, total }) =>
        patchItem(item.id, { status: "uploading", done, total }),
      );
      const title = stripExt(item.fileName, "pptx", "Imported Presentation");
      const created = await getOrCreateDoc(item, { title, type: "slides" });
      d.stashSlides(created.id, document);
      finish(item.id, created);
    } else if (item.kind === "pdf") {
      patchItem(item.id, { status: "uploading" });
      const title = stripExt(item.fileName, "pdf", "Untitled PDF");
      // A prior attempt may have already uploaded the blob and created the
      // document; only re-upload if we don't yet have a docId to resume.
      let fileId: string | undefined;
      if (!item.docId) {
        ({ id: fileId } = await d.uploadPdf(file));
      }
      const created = await getOrCreateDoc(item, { title, type: "pdf", fileId });
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
