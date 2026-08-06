import {
  classifyUploadKind,
  CLIENT_PARSE_MAX_BYTES,
  SKIP_REASON,
  type UploadKind,
} from "./upload-kind";
import { getDocumentPath as getDocumentPathDefault } from "./document-list-utils";
import { importXlsx } from "@/app/spreadsheet/xlsx-actions";
import {
  importCsvFile,
  importSheetViaBackend,
} from "@/app/spreadsheet/csv-actions";
import { importDocx } from "@/app/docs/docx-actions";
import { importPptxFile } from "@/app/slides/pptx-actions";
import { uploadFile, uploadImportFile } from "@/api/files";
import { createDocument, deleteDocument } from "@/api/documents";
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
  /** Folder the list was viewing when the file was enqueued (null = workspace
   *  root). Threaded into createDoc so a dropped file lands where the user is,
   *  matching the manual "New …" path. */
  folderId?: string | null;
  status: UploadStatus;
  done: number;
  total: number;
  /**
   * Progress wording chosen by whatever drives the item, shown in place of the
   * `done/total` fraction. Only externally driven items set it: not every one
   * of their stages is countable ("Reading board… 1,250 items" has no
   * denominator), and a bare spinner is what got a working import reported as
   * stuck in the first place.
   */
  detail?: string;
  docId?: string;
  docPath?: string;
  /** Uploaded blob id (pdf/image). Set before createDoc so a retry reuses the
   *  blob instead of re-uploading/orphaning it. */
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

export function enqueue(
  files: File[],
  workspaceId?: string,
  folderId?: string | null,
): UploadItem[] {
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
      folderId,
      status: kind ? "pending" : "skipped",
      done: 0,
      total: 0,
      reason: kind ? undefined : SKIP_REASON,
    };
  });
  replace([...items, ...created]);
  return created;
}

/**
 * Register a row for work this queue does NOT run itself, and hand back its
 * id so the caller can drive it with `patchItem`.
 *
 * The panel is just a view over this list, so anything that wants to report
 * long-running progress there needs a row — even when there is no `File` and
 * no upload. The Miro import is the first such caller: its work is a single
 * streamed request whose credential must stay in the caller's closure, so the
 * queue cannot (and must not) be able to run or re-run it.
 *
 * Created in `"parsing"`, never `"pending"`, and that is load-bearing:
 * `nextPendingId` only ever selects `"pending"`, so the file worker can never
 * pick this row up and dereference the `file` it does not have. `"parsing"`
 * also makes `activeCount()` count it, which is correct — it IS active work,
 * and it should hold a concurrency slot against file uploads.
 */
export function enqueueExternal(input: {
  fileName: string;
  kind: UploadKind;
  workspaceId?: string;
  folderId?: string | null;
}): string {
  const item: UploadItem = {
    id: `u${++seq}`,
    fileName: input.fileName,
    kind: input.kind,
    workspaceId: input.workspaceId,
    folderId: input.folderId,
    status: "parsing",
    done: 0,
    total: 0,
  };
  replace([...items, item]);
  return item.id;
}

export function patchItem(id: string, patch: Partial<UploadItem>): void {
  replace(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
}

export function removeItem(id: string): void {
  replace(items.filter((it) => it.id !== id));
}

/**
 * Remove a row from the panel, cleaning up any remote resource it orphaned.
 *
 * An errored item may have already created its backend document (docId set)
 * before failing to apply content — an empty orphan. Dropping the row without
 * this would leak an empty "Imported …" document into the workspace.
 * Best-effort: a failed delete still removes the local row (the user asked to
 * dismiss it).
 *
 * A staged import blob (`fileId` on a backend-parsed sheet) is NOT released by
 * that delete: the sheet stores cells, never a `fileId`, so the document holds
 * no reference to reclaim. Those are collected by the `imports/` expiry rule
 * instead — see `FileService.ensureImportExpiry`.
 */
export function dismissItem(id: string): void {
  const item = items.find((it) => it.id === id);
  if (item && item.status === "error" && item.docId) {
    void activeDeps.deleteDoc(item.docId).catch(() => {});
  }
  removeItem(id);
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
  importCsvFile: typeof importCsvFile;
  importSheetViaBackend: typeof importSheetViaBackend;
  importDocx: typeof importDocx;
  importPptxFile: typeof importPptxFile;
  uploadFile: typeof uploadFile;
  uploadImportFile: typeof uploadImportFile;
  createDoc: (
    workspaceId: string | undefined,
    payload: {
      title: string;
      type: DocumentType;
      fileId?: string;
      folderId?: string | null;
    },
  ) => Promise<Document>;
  getDocumentPath: (doc: DocRef) => string;
  applyContent: typeof applyImportedContentDefault;
  deleteDoc: typeof deleteDocument;
  sleep: (ms: number) => Promise<void>;
}

const defaultDeps: UploadDeps = {
  importXlsx,
  importCsvFile,
  importSheetViaBackend,
  importDocx,
  importPptxFile,
  uploadFile,
  uploadImportFile,
  createDoc: (ws, payload) =>
    ws ? createWorkspaceDocument(ws, payload) : createDocument(payload),
  getDocumentPath: getDocumentPathDefault,
  applyContent: applyImportedContentDefault,
  deleteDoc: deleteDocument,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

let activeDeps: UploadDeps = defaultDeps;
// Fired once per item when it reaches a terminal state (done or error) so the
// host can refresh the list, surface a failure, or warn about a lossy import.
let onItemSettledCb: ((item: UploadItem) => void) | undefined;

function stripExt(name: string, fallback: string): string {
  return name.replace(/\.[^.]+$/, "") || fallback;
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
  // Route the document into the folder the list was viewing at enqueue time
  // (null/undefined = workspace root), mirroring the manual "New …" path.
  const created = await activeDeps.createDoc(item.workspaceId, {
    ...payload,
    folderId: item.folderId,
  });
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

/**
 * Fire the host's settled callback for an externally driven item.
 *
 * An `enqueueExternal` row reaches its terminal state through `patchItem`
 * rather than through the worker, so it has to announce itself. Without this
 * the host would never refresh the documents list or report the failure — the
 * two things that make a finished background import visible at all.
 */
export function settleExternal(id: string): void {
  settle(id);
}

const MAX_RATE_RETRIES = 6;

/** Backoff (ms) for a rate-limited (429) request, or null if not a 429. */
function rateLimitBackoffMs(err: unknown, attempt: number): number | null {
  const status = (err as { status?: number } | null | undefined)?.status;
  if (status !== 429) return null;
  const retryAfter = (err as { retryAfterMs?: number }).retryAfterMs;
  if (typeof retryAfter === "number" && retryAfter >= 0) return retryAfter;
  // Exponential backoff capped at 15s: 1s, 2s, 4s, 8s, 15s, 15s.
  return Math.min(1000 * 2 ** attempt, 15000);
}

/**
 * A CSV too large to parse in the browser is parsed by the backend. Upload the
 * blob at most once per item and persist its id *before* the parse, exactly as
 * the pdf/image branch does, so a retry whose earlier failure was in the
 * preview reuses the blob instead of orphaning it with a second upload.
 *
 * `detail` carries the wording because neither stage has a denominator: the
 * blob upload reports no progress and the server parse is one opaque request.
 * Without it the row shows a bare spinner for the whole round trip — the case
 * `UploadItem.detail` exists for.
 */
async function importSheetViaBackendUpload(
  item: UploadItem,
  file: File,
  workspaceId: string,
) {
  const d = activeDeps;
  patchItem(item.id, { status: "uploading", detail: "Uploading…" });
  try {
    let fileId = item.fileId;
    if (!fileId) {
      // Not `uploadFile`: data blobs go to the workspace-scoped import route,
      // which is the only one whose size ceiling admits them.
      ({ id: fileId } = await d.uploadImportFile(workspaceId, file));
      patchItem(item.id, { fileId });
    }
    patchItem(item.id, { status: "parsing", detail: "Parsing on server…" });
    try {
      return await d.importSheetViaBackend(workspaceId, fileId);
    } catch (err) {
      // 410: the staged blob expired (they live a day) or was otherwise
      // reclaimed. The id is spent, so drop it — without this every later
      // Retry re-previews an id the server can never resolve again, and the
      // row can never recover. Cleared here rather than in `retry` because
      // this is the only place that knows the id died rather than the parse.
      if ((err as { status?: number } | null)?.status === 410) {
        patchItem(item.id, { fileId: undefined });
      }
      throw err;
    }
  } finally {
    // The shared tail below reports its own status; leaving `detail` set
    // (from either stage) would pin it over the document-creation stage, or
    // strand it on an upload failure the outer error handling never clears.
    patchItem(item.id, { detail: undefined });
  }
}

async function runItem(item: UploadItem): Promise<void> {
  const d = activeDeps;
  const file = item.file!;
  let attempt = 0;
  try {
    // Retry loop: a 429 (bulk-upload rate limit) backs off and retries the
    // same item. Re-entry is safe because fileId/docId are persisted before
    // the failing step, so uploadFile/getOrCreateDoc never duplicate work.
    for (;;) {
      // patchItem replaces items immutably, so the captured `item` goes stale
      // after a persist. Re-read it each attempt so a retry sees the fileId/
      // docId a prior attempt already persisted (idempotent re-entry).
      item = items.find((it) => it.id === item.id) ?? item;
      try {
        if (item.kind === "sheet") {
          patchItem(item.id, { status: "parsing" });
          // The queue only routes by `kind`; the sheet formats split here.
          // `.tsv` joins `.csv` because the importer resolves the delimiter
          // from the file name.
          const isCsv = /\.(csv|tsv)$/i.test(item.fileName);
          const oversized = isCsv && file.size > CLIENT_PARSE_MAX_BYTES;
          // XLSX stays in the browser at any size: it has no backend parser
          // (`read_csv` cannot open a workbook) and the client path works.
          // The preview is workspace-scoped for authorization, so an item
          // enqueued outside a workspace (the `/documents` route) has nowhere
          // to send the blob — and past the threshold the browser cannot read
          // the file either, so say so rather than dying inside `File.text()`.
          if (oversized && !item.workspaceId) {
            throw new Error(
              "This file is too large to import outside a workspace.",
            );
          }
          const large =
            oversized && item.workspaceId
              ? await importSheetViaBackendUpload(item, file, item.workspaceId)
              : undefined;
          // `??` short-circuits, so the client parser never runs for a large CSV.
          const parsed =
            large ??
            (isCsv ? await d.importCsvFile(file) : await d.importXlsx(file));
          const { document } = parsed;
          const title = stripExt(item.fileName, "Imported Sheet");
          const created = await getOrCreateDoc(item, { title, type: "sheet" });
          // Persist the parsed content into the Yorkie doc now (see
          // apply-imported-content.ts) so "done" means it is actually saved —
          // not merely stashed in memory awaiting an editor mount.
          patchItem(item.id, { status: "uploading" });
          await d.applyContent(created.id, { type: "sheet", document });
          // The cap lives in the engine, so a client-parsed file can be
          // truncated too — the warning belongs to both paths, not just the
          // backend one. XLSX has no cap yet and reports neither field.
          const truncation =
            "truncated" in parsed && parsed.truncated
              ? `Only the first ${parsed.rowCount.toLocaleString()} rows were imported.`
              : undefined;
          finish(item.id, created, truncation);
        } else if (item.kind === "doc") {
          patchItem(item.id, { status: "parsing" });
          const { doc } = await d.importDocx(file, ({ done, total }) =>
            patchItem(item.id, { status: "uploading", done, total }),
          );
          const title = stripExt(item.fileName, "Imported Document");
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
          const title = stripExt(item.fileName, "Imported Presentation");
          const created = await getOrCreateDoc(item, { title, type: "slides" });
          patchItem(item.id, { status: "uploading" });
          await d.applyContent(created.id, { type: "slides", document });
          // Surface lossy-conversion fallbacks the same way the old flow did.
          const summary = report.summary();
          const warning =
            summary && summary !== "Imported with no fallbacks." ? summary : undefined;
          finish(item.id, created, warning);
        } else if (item.kind === "pdf" || item.kind === "image") {
          patchItem(item.id, { status: "uploading" });
          const fallback = item.kind === "pdf" ? "Untitled PDF" : "Untitled Image";
          const title = stripExt(item.fileName, fallback);
          // Upload the blob at most once per item: persist the returned fileId
          // immediately so a retry whose earlier failure was in createDoc reuses
          // the blob instead of orphaning it with a second upload.
          let fileId = item.fileId;
          if (!fileId) {
            ({ id: fileId } = await d.uploadFile(file));
            patchItem(item.id, { fileId });
          }
          const created = await getOrCreateDoc(item, {
            title,
            type: item.kind,
            fileId,
          });
          finish(item.id, created);
        }
        break;
      } catch (err) {
        const backoff =
          attempt < MAX_RATE_RETRIES ? rateLimitBackoffMs(err, attempt) : null;
        if (backoff === null) throw err;
        attempt += 1;
        await d.sleep(backoff);
      }
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

/**
 * Whether `retry(id)` can actually re-run this item.
 *
 * The worker replays an item from its retained `File`, so a row without one
 * has nothing to replay: `retry` would move it back to `"pending"` and the
 * worker would dereference a `file` that is not there. Externally driven rows
 * (Miro) are the case that matters — re-running one would need the access
 * token, which is deliberately not kept anywhere after the request goes out.
 * The UI asks this rather than testing a kind, so any future externally driven
 * row is covered by construction.
 */
export function isRetryable(item: UploadItem): boolean {
  return item.file !== undefined;
}

export function retry(id: string): void {
  const item = items.find((it) => it.id === id);
  // Defensive, not decorative: the panel already hides the control, and this
  // makes a stray programmatic call a no-op instead of parking an
  // unprocessable row in "pending" forever.
  if (item && !isRetryable(item)) return;
  patchItem(id, { status: "pending", reason: undefined, done: 0, total: 0 });
  pump();
}
