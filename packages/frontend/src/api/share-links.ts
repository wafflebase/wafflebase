import { fetchWithAuth } from "./auth";
import { assertOk } from "./http-error";

export type ShareLink = {
  id: string;
  token: string;
  role: string;
  documentId: string;
  createdBy: number;
  createdAt: string;
  expiresAt: string | null;
};

export type ResolvedShareLink = {
  documentId: string;
  role: string;
  title: string;
  type: "sheet" | "doc" | "slides" | "pdf" | "note";
};

/**
 * The caller's share-link capabilities for a document, resolved server-side
 * from workspace ownership + document authorship (see docs/design/sharing.md).
 */
export type ShareLinkPermissions = {
  /** Workspace owner or document author — may create `editor` links. */
  canCreateEditorLink: boolean;
};

/**
 * A listed share link, annotated server-side with whether the caller may
 * revoke it (manager of the document, or its creator).
 */
export type ShareLinkListItem = ShareLink & {
  canDelete: boolean;
};

export type ShareLinksResponse = {
  links: ShareLinkListItem[];
  permissions: ShareLinkPermissions;
};

/**
 * Creates share link.
 */
export async function createShareLink(
  documentId: string,
  role: string,
  expiration: string | null
): Promise<ShareLink> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/documents/${documentId}/share-links`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, expiration }),
    }
  );
  await assertOk(response, "Failed to create share link");
  return response.json();
}

/**
 * Returns share links.
 */
export async function getShareLinks(
  documentId: string
): Promise<ShareLinksResponse> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/documents/${documentId}/share-links`
  );
  await assertOk(response, "Failed to fetch share links");
  return response.json();
}

/**
 * Deletes share link.
 */
export async function deleteShareLink(id: string): Promise<void> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/share-links/${id}`,
    { method: "DELETE" }
  );
  await assertOk(response, "Failed to delete share link");
}

/**
 * Resolves share link.
 */
export async function resolveShareLink(
  token: string
): Promise<ResolvedShareLink> {
  const response = await fetch(
    `${import.meta.env.VITE_BACKEND_API_URL}/share-links/${token}/resolve`
  );
  await assertOk(response, "Invalid share link", {
    statusMessages: {
      410: "Share link has expired",
    },
  });
  return response.json();
}
