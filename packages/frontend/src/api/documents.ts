import type { Document, DocumentType } from "@/types/documents";
import { fetchWithAuth } from "./auth";
import { assertOk } from "./http-error";
import { seg } from "./url";

/**
 * Creates document.
 */
export async function createDocument(payload: {
  title: string;
  type?: DocumentType;
  fileId?: string;
  fileSize?: number;
  mimeType?: string;
}): Promise<Document> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/documents`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  await assertOk(response, "Couldn't create the document");

  return response.json();
}

/**
 * Fetches documents.
 */
export async function fetchDocuments(): Promise<Array<Document>> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/documents`
  );
  await assertOk(response, "Couldn't load documents");
  return await response.json();
}

/**
 * Fetches document.
 */
export async function fetchDocument(id: string): Promise<Document> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/documents/${seg(id)}`
  );
  await assertOk(response, "Couldn't load the document");
  const document = await response.json();
  if (!document) {
    throw new Error("Document not found");
  }
  return document;
}

/**
 * Renames document.
 */
export async function renameDocument(
  id: string,
  title: string
): Promise<Document> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/documents/${seg(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }
  );

  await assertOk(response, "Couldn't rename the document");

  return response.json();
}

/**
 * Moves a document to another workspace and/or into a folder. Omit a field
 * to leave it unchanged; pass `folderId: null` to move it to the workspace
 * root.
 */
export async function moveDocument(
  id: string,
  target: { workspaceId?: string; folderId?: string | null }
): Promise<Document> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/documents/${seg(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(target),
    }
  );

  await assertOk(response, "Couldn't move the document");

  return response.json();
}

/**
 * Duplicates a document into the same workspace and folder as
 * `<title> (copy)`. The whole copy — Yorkie content or stored blob — happens
 * server-side (see docs/design/document-copy.md), so this is a single request
 * regardless of document type or size. Allowed for anyone who can read the
 * source: unlike move/delete it does not require `canManage`.
 */
export async function copyDocument(id: string): Promise<Document> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/documents/${seg(id)}/copy`,
    {
      method: "POST",
    }
  );

  await assertOk(response, "Couldn't copy the document");

  return response.json();
}

/**
 * Copies many documents. There is no atomic bulk endpoint — each copy is an
 * independent server-side operation — so these run **sequentially**, and a
 * failure part-way leaves the copies made before it in place. The rejection
 * carries those ids so the caller can still surface (and refetch) them rather
 * than reporting a flat failure for work that partly succeeded.
 */
export class BulkCopyError extends Error {
  constructor(
    readonly copied: Document[],
    readonly cause: unknown
  ) {
    super(cause instanceof Error ? cause.message : "Couldn't copy documents");
    this.name = "BulkCopyError";
  }
}

export async function copyDocuments(ids: string[]): Promise<Document[]> {
  const copied: Document[] = [];
  for (const id of ids) {
    try {
      copied.push(await copyDocument(id));
    } catch (err) {
      throw new BulkCopyError(copied, err);
    }
  }
  return copied;
}

/**
 * Moves a document to its workspace's Trash. Soft: the row keeps its content
 * and can be brought back with {@link restoreDocument}; only
 * {@link deleteDocumentForever} destroys it. Silent — the caller decides what
 * to tell the user (the documents list toasts with an Undo action).
 */
export async function deleteDocument(id: string): Promise<void> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/documents/${seg(id)}`,
    {
      method: "DELETE",
    }
  );
  await assertOk(response, "Couldn't move the document to the Trash");
}

/**
 * Permanently deletes a document already in the Trash, along with its stored
 * blob. There is no undo. A live id answers 404: the backend only destroys
 * what the Trash holds, so a stale list can never reach a restored document.
 */
export async function deleteDocumentForever(id: string): Promise<void> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/documents/${seg(id)}?permanent=true`,
    {
      method: "DELETE",
    }
  );
  await assertOk(response, "Couldn't delete the document forever");
}

/**
 * Silently removes a document nobody asked for, such as the half-created
 * orphan of a failed import: trash it, then delete it from the Trash, since a
 * bare {@link deleteDocumentForever} refuses a live document.
 */
export async function discardDocument(id: string): Promise<void> {
  await deleteDocument(id);
  await deleteDocumentForever(id);
}

/**
 * Brings a document back from the Trash. It returns to its folder, or to the
 * workspace root if that folder was deleted in the meantime.
 */
export async function restoreDocument(id: string): Promise<Document> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/documents/${seg(id)}/restore`,
    {
      method: "POST",
    }
  );
  await assertOk(response, "Couldn't restore the document");
  return response.json();
}

/**
 * Restores many documents. There is no bulk restore endpoint, so each id is
 * its own request; they run in parallel and the first failure rejects.
 */
export async function restoreDocuments(ids: string[]): Promise<Document[]> {
  return Promise.all(ids.map((id) => restoreDocument(id)));
}

/** A document in the Trash, as `GET /workspaces/:id/trash` lists it. */
export type TrashedDocument = Document & { deletedAt: string };

/**
 * Lists a workspace's Trash, most recently deleted first. `workspaceId` may
 * be the workspace's id or its slug, like every other workspace route.
 */
export async function fetchTrash(
  workspaceId: string
): Promise<TrashedDocument[]> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/workspaces/${seg(workspaceId)}/trash`
  );
  await assertOk(response, "Couldn't load the Trash");
  return response.json();
}

/**
 * Moves many documents at once. Atomic on the server: if the caller does not
 * manage every id the whole request is rejected. Omit a field to leave it
 * unchanged; pass `folderId: null` to move to the workspace root.
 */
export async function moveDocuments(
  ids: string[],
  target: { workspaceId?: string; folderId?: string | null }
): Promise<{ moved: string[] }> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/documents/move`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, ...target }),
    }
  );
  await assertOk(response, "Couldn't move documents");
  return response.json();
}

/**
 * Moves many documents to the Trash at once (manager-gated per id on the
 * server). Soft, like {@link deleteDocument}.
 */
export async function deleteDocuments(
  ids: string[]
): Promise<{ deleted: string[] }> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/documents/delete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }
  );
  await assertOk(response, "Couldn't delete documents");
  return response.json();
}

/**
 * Permanently deletes many documents at once (manager-gated per id on the
 * server). There is no undo.
 */
export async function deleteDocumentsForever(
  ids: string[]
): Promise<{ deleted: string[] }> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/documents/delete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, permanent: true }),
    }
  );
  await assertOk(response, "Couldn't delete documents forever");
  return response.json();
}
