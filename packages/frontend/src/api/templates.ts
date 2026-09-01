import { fetchWithAuth } from "./auth";
import { assertOk } from "./http-error";
import { seg } from "./url";
import type { Document } from "@/types/documents";

/**
 * The template gallery — publishing a document as a template and starting a
 * new document from one. See docs/design/template-gallery.md.
 */
export type TemplateVisibility = "unlisted" | "workspace" | "public";

export type TemplateListing = {
  id: string;
  documentId: string;
  documentType: string;
  title: string;
  description: string | null;
  category: string | null;
  tags: string[];
  thumbnailId: string | null;
  visibility: TemplateVisibility;
  status: string;
  useCount: number;
  publishedAt: string | null;
  author: { id: number; username: string; photo: string | null } | null;
  /**
   * The `viewer` share token backing the read-only preview, or `null` if that
   * link was revoked — the landing page then shows the card without a live
   * preview rather than failing.
   */
  previewToken: string | null;
  canManage: boolean;
};

export type PublishTemplateInput = {
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
  thumbnailId?: string;
  visibility?: TemplateVisibility;
  acceptLicense?: boolean;
};

/** Publish (or re-publish) a document as a template. Manager-gated. */
export async function publishTemplate(
  documentId: string,
  input: PublishTemplateInput = {}
): Promise<TemplateListing> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/documents/${seg(documentId)}/template`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  await assertOk(response, "Failed to publish template");
  return response.json();
}

/** The listing attached to a document, or `null` if it is not published. */
export async function getDocumentTemplate(
  documentId: string
): Promise<TemplateListing | null> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/documents/${seg(documentId)}/template`
  );
  await assertOk(response, "Failed to load template");
  return response.json();
}

export async function updateTemplate(
  id: string,
  input: PublishTemplateInput
): Promise<TemplateListing> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/templates/${seg(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  await assertOk(response, "Failed to update template");
  return response.json();
}

/** Unpublish. The listing and its preview link go; the document stays. */
export async function unpublishTemplate(id: string): Promise<void> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/templates/${seg(id)}`,
    { method: "DELETE" }
  );
  await assertOk(response, "Failed to unpublish template");
}

/**
 * Read a listing. Unauthenticated on purpose — `/t/:id` must render for a
 * visitor who has not signed in yet. `fetchWithAuth` still sends the session
 * cookie when there is one, which is what surfaces workspace-tier listings and
 * `canManage`.
 */
export async function getTemplate(id: string): Promise<TemplateListing> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/templates/${seg(id)}`
  );
  await assertOk(response, "Template not found");
  return response.json();
}

/** Start a new document from a template, in a workspace the caller belongs to. */
export async function createFromTemplate(
  id: string,
  workspaceId: string,
  folderId?: string
): Promise<Document> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/templates/${seg(id)}/use`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, ...(folderId ? { folderId } : {}) }),
    }
  );
  await assertOk(response, "Failed to create a document from this template");
  return response.json();
}
