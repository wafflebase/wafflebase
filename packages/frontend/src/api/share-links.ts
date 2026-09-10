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
 *
 * Enumerated from what the handler actually answers rather than taken as "any
 * 4xx that is not a timeout or a rate-limit". `GET /share-links/:token/resolve`
 * is unauthenticated and its only failures are
 * `ShareLinkService.findByToken`'s: `404` (revoked, or never existed) and
 * `410` (expired). Every other 4xx on that request came from something in
 * front of the handler — an auth proxy, a WAF, a CDN, a redeploy answering the
 * wrong route — and is a request that never reached an answer, which is
 * exactly the class this predicate exists to keep out. A `401`/`403` in
 * particular is *not* a verdict here: there is nothing to be unauthorized
 * for. A proxy that answers `404` is still indistinguishable from a revoked
 * link, which is inherent; narrowing removes the cases where it is not.
 */
const SHARE_LINK_VERDICT_STATUSES = new Set([
  404, // revoked, or never existed
  410, // expired
]);

export function isRevokedShareLinkError(error: unknown): boolean {
  return (
    error instanceof HttpError && SHARE_LINK_VERDICT_STATUSES.has(error.status)
  );
}

/**
 * `useQuery`'s `retry` for the periodic re-resolve: try a failed resolve once
 * more, unless the server has already given its verdict on the link.
 *
 * Retrying a `404`/`410` only re-asks a question that has been answered, and
 * delays closing a view whose authority is gone. Retrying anything else once
 * absorbs the single-request blip that is by far the common case, and the
 * `refetchInterval` keeps trying after that.
 */
export function shouldRetryShareLinkResolve(
  failureCount: number,
  error: unknown,
): boolean {
  return !isRevokedShareLinkError(error) && failureCount < 1;
}

/**
 * Must a failed resolve close the shared-document view?
 *
 * This is the composition {@link isRevokedShareLinkError} exists for, split
 * out of `SharedDocumentByToken` so it can be tested without mounting the
 * editor and every provider under it. Two conjuncts, each load-bearing:
 *
 * - `!resolved` — the link never resolved *once*, so there is no session to
 *   protect and no authority to present. Any failure closes the view,
 *   transient or not; the alternative is a blank frame with no explanation.
 * - `isRevokedShareLinkError(error)` — the link did resolve, so a live
 *   session may be holding edits that have not synced. Only the server's
 *   verdict may evict it. A background refetch that fails while `resolved`
 *   still holds the last good link (a closed laptop lid, a backend restart)
 *   leaves that session alone.
 *
 * Collapsing this to `Boolean(error)` was the original bug; dropping
 * `!resolved` is the opposite one, and would leave a link that never resolved
 * at all rendering nothing. `share-links.test.ts` covers both directions.
 */
export function isShareLinkResolveFatal(
  error: unknown,
  resolved: unknown,
): boolean {
  return Boolean(error) && (!resolved || isRevokedShareLinkError(error));
}
