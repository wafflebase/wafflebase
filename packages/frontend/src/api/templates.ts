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
  /**
   * The review decision, present only for the listing's manager (and for a
   * reviewer reading their own queue). A rejected or removed listing is one
   * its publisher can no longer act on, so the reason has to be reachable
   * somewhere they can see it — the notification carrying the same note is
   * best-effort, and is suppressed when the reviewer is the publisher.
   */
  review: {
    submittedAt: string | null;
    reviewedAt: string | null;
    note: string | null;
    /**
     * The content watermark as of this response. A reviewer echoes it back
     * when approving, which is what makes the approval about the version they
     * read rather than about whatever the row holds by then.
     */
    contentAt: string | null;
  } | null;
};

/**
 * A gallery card. `TemplateListing` minus `previewToken` — the collection
 * endpoint never returns one, so the type does not have one to read.
 */
export type TemplateCard = Omit<TemplateListing, "previewToken">;

export type TemplateBrowsePage = {
  items: TemplateCard[];
  /** Pass back as `cursor`; `null` on the last page. */
  nextCursor: string | null;
};

/**
 * The category taxonomy, mirroring `packages/backend/src/template/
 * template-taxonomy.ts`. Closed on both sides so the facet means something;
 * the backend is the enforcing copy.
 */
export const TEMPLATE_CATEGORIES = [
  "Business",
  "Education",
  "Personal",
  "Project management",
  "Finance",
  "Marketing",
  "Design",
  "Other",
] as const;

export type BrowseTemplatesQuery = {
  scope: "workspace" | "public";
  workspaceId?: string;
  type?: string;
  category?: string;
  tag?: string;
  q?: string;
  sort?: "popular" | "recent";
  cursor?: string;
  limit?: number;
};

/** Browse listings the caller may see. Never returns a preview token. */
export async function browseTemplates(
  query: BrowseTemplatesQuery
): Promise<TemplateBrowsePage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/templates?${params.toString()}`
  );
  await assertOk(response, "Failed to load templates");
  return response.json();
}

export type PublishTemplateInput = {
  title?: string;
  description?: string;
  /** `null` clears it; omitting the field leaves it unchanged. */
  category?: string | null;
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

export type ReviewDecision = "approve" | "reject" | "takedown";

/**
 * Ask for the public tier. A separate call from `updateTemplate` because
 * `visibility` is the *effective* tier and no request body may write `public`
 * to it — only an approval does.
 */
export async function submitTemplateForReview(
  id: string
): Promise<TemplateListing> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/templates/${seg(id)}/submit`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acceptLicense: true }),
    }
  );
  await assertOk(response, "Failed to submit this template for review");
  return response.json();
}

/**
 * The review queue. Unlike every other collection here this **does** carry
 * `previewToken`: a reviewer belongs to neither the publisher's workspace nor
 * the document, so nothing else would let them see what they are deciding.
 */
export async function listTemplatesForReview(): Promise<TemplateListing[]> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/admin/templates/review`
  );
  await assertOk(response, "Failed to load the review queue");
  return response.json();
}

export async function reviewTemplate(
  id: string,
  decision: ReviewDecision,
  note?: string,
  /**
   * The `review.contentAt` the queue row carried. Approving without it, or
   * with a stale one, is refused with a 409 — the reviewer is attesting to the
   * version they actually read.
   */
  contentAt?: string | null
): Promise<TemplateListing> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/templates/${seg(id)}/review`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision,
        ...(note ? { note } : {}),
        ...(contentAt ? { contentAt } : {}),
      }),
    }
  );
  await assertOk(response, "Failed to record this decision");
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
