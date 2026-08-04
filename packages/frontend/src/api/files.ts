import { fetchWithAuth } from "./auth";
import { assertOk } from "./http-error";

const BACKEND_BASE = import.meta.env.VITE_BACKEND_API_URL ?? "";

/** Upload a blob (pdf or image); returns the stored blob id. */
export async function uploadFile(file: File): Promise<{ id: string }> {
  const formData = new FormData();
  formData.append("file", file, file.name);
  const res = await fetchWithAuth(`${BACKEND_BASE}/files`, {
    method: "POST",
    body: formData,
  });
  await assertOk(res, "File upload failed");
  return (await res.json()) as { id: string };
}

/** Document-scoped, permission-gated URL that streams the stored blob. */
export function fileUrl(documentId: string, token?: string): string {
  const base = `${BACKEND_BASE}/documents/${documentId}/file`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

/**
 * First rows of an uploaded data file, parsed server-side. Structurally the
 * datasource query result minus `executionTime` — declared as a subset rather
 * than reusing `QueryResult`, whose `QueryColumn.dataTypeID` is a Postgres OID
 * a file engine has no equivalent for. `QueryResult` still assigns to this
 * type, so a shared backend response shape keeps working.
 */
export interface FileImportPreview {
  /**
   * Always the reader's placeholders (`column0`, …) — a key order and a width,
   * never text for the sheet. Header text arrives in `rows[0]`.
   */
  columns: Array<{ name: string }>;
  rows: Array<Record<string, unknown>>;
  /** Rows returned, header included — it is row 0 of `rows`. */
  rowCount: number;
  /** The source had more rows than were returned. */
  truncated: boolean;
  /**
   * `rows[0]` is the file's header rather than a record, so it should be
   * styled as one. It does not change where the row's text comes from.
   */
  hasHeader: boolean;
}

/**
 * Stage a data file for server-side parsing.
 *
 * Separate from `uploadFile` because the two routes carry different size
 * ceilings — a Multer limit is fixed per route, so the 200 MB a CSV may need
 * cannot sit on the route that also takes images.
 */
export async function uploadImportFile(
  workspaceId: string,
  file: File,
): Promise<{ id: string }> {
  const formData = new FormData();
  formData.append("file", file, file.name);
  const res = await fetchWithAuth(
    `${BACKEND_BASE}/workspaces/${encodeURIComponent(workspaceId)}/file-imports/upload`,
    { method: "POST", body: formData },
  );
  await assertOk(res, "File upload failed");
  return (await res.json()) as { id: string };
}

/**
 * Parse an already-uploaded data file server-side and return its first rows.
 *
 * Workspace-scoped because a blob has no owner of its own: `POST /files` only
 * checks the JWT and hands back a random UUID, and the one authorized read
 * path goes through a document the blob is not attached to yet. The workspace
 * in the path is what the backend can actually check membership against.
 */
export async function previewFileImport(
  workspaceId: string,
  fileId: string,
): Promise<FileImportPreview> {
  const res = await fetchWithAuth(
    `${BACKEND_BASE}/workspaces/${encodeURIComponent(workspaceId)}/file-imports/preview`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId }),
    },
  );
  await assertOk(res, "File import failed");
  return (await res.json()) as FileImportPreview;
}
