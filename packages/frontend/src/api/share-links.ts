import { fetchWithAuth } from "./auth";
import { assertOk, HttpError } from "./http-error";
import { seg } from "./url";

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
  type:
    | "sheet"
    | "doc"
    | "slides"
    | "pdf"
    | "note"
    | "board"
    | "image"
    | "file";
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
    `${import.meta.env.VITE_BACKEND_API_URL}/documents/${seg(documentId)}/share-links`,
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
    `${import.meta.env.VITE_BACKEND_API_URL}/documents/${seg(documentId)}/share-links`
  );
  await assertOk(response, "Failed to fetch share links");
  return response.json();
}

/**
 * Deletes share link.
 */
export async function deleteShareLink(id: string): Promise<void> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/share-links/${seg(id)}`,
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
    `${import.meta.env.VITE_BACKEND_API_URL}/share-links/${seg(token)}/resolve`
  );
  await assertOk(response, "Invalid share link", {
    statusMessages: {
      410: "Share link has expired",
    },
  });
  return response.json();
}

/**
 * Did a failed {@link resolveShareLink} carry the server's *verdict* on the
 * link — revoked, expired, or never valid — as opposed to the request never
 * reaching an answer at all?
 *
 * A caller that re-resolves its token on an interval (`SharedDocumentByToken`)
 * has to tell the two apart before it acts. Only a verdict may evict a live
 * editing session: react-query keeps its last good `data` while reporting
 * `error` for every subsequent background refetch failure, so treating any
 * error as fatal tore the editor down — losing whatever had not synced — on
 * the first laptop sleep, flaky network or backend restart that outlasted the
 * retry. A 5xx, a rate-limit, a timeout, and the `TypeError` `fetch()` throws
 * when it cannot connect all say nothing about the link.
 */
export function isRevokedShareLinkError(error: unknown): boolean {
  return (
    error instanceof HttpError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429
  );
}
