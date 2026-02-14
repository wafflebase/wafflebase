import type { Document } from "@/types/documents";
import { toast } from "sonner";
import { fetchWithAuth } from "./auth";

export async function createDocument(payload: {
  title: string;
}): Promise<Document> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/documents`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    throw new Error("Failed to create document");
  }

  return response.json();
}

export async function fetchDocuments(): Promise<Array<Document>> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/documents`
  );
  if (!response.ok) {
    throw new Error("Failed to fetch documents");
  }
  return await response.json();
}

export async function fetchDocument(id: string): Promise<Document> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/documents/${id}`
  );
  if (!response.ok) {
    throw new Error("Failed to fetch document");
  }
  const document = await response.json();
  if (!document) {
    throw new Error("Document not found");
  }
  return document;
}

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

  if (!response.ok) {
    throw new Error("Failed to rename document");
  }

  return response.json();
}

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
    throw new Error("Failed to delete document");
  }
}
