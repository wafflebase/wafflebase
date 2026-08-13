import type { Document, DocumentType } from "@/types/documents";
import { toast } from "sonner";
import { fetchWithAuth } from "./auth";
import { assertOk } from "./http-error";

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

  await assertOk(response, "Failed to create document");

  return response.json();
}

/**
 * Fetches documents.
 */
export async function fetchDocuments(): Promise<Array<Document>> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/documents`
  );
  await assertOk(response, "Failed to fetch documents");
  return await response.json();
}

/**
 * Fetches document.
 */
export async function fetchDocument(id: string): Promise<Document> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/documents/${id}`
  );
  await assertOk(response, "Failed to fetch document");
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
    `${import.meta.env.VITE_BACKEND_API_URL}/documents/${id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }
  );

  await assertOk(response, "Failed to rename document");

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
    `${import.meta.env.VITE_BACKEND_API_URL}/documents/${id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(target),
    }
  );

  await assertOk(response, "Failed to move document");

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
    `${import.meta.env.VITE_BACKEND_API_URL}/documents/${id}/copy`,
    {
      method: "POST",
    }
  );

  await assertOk(response, "Failed to copy document");

  return response.json();
}

/**
 * Deletes document.
 */
export async function deleteDocument(id: string): Promise<void> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/documents/${id}`,
    {
      method: "DELETE",
    }
  );

  if (response.ok) {
    toast.success("Document deleted successfully");
  } else {
    toast.error("Failed to delete document");
    await assertOk(response, "Failed to delete document");
  }
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
  await assertOk(response, "Failed to move documents");
  return response.json();
}

/**
 * Deletes many documents at once (manager-gated per id on the server).
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
  await assertOk(response, "Failed to delete documents");
  return response.json();
}
