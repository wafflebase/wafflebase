/**
 * Workspace-scoped image URLs served by the backend, e.g.
 * `.../api/v1/workspaces/<wid>/images/<uuid>.png`. Matched anywhere in the
 * string so it works whether the stored `src` is absolute (with the backend
 * origin) or root-relative.
 */
const WORKSPACE_IMAGE_RE = /\/api\/v1\/workspaces\/[^/]+\/images\/[^/?#]+/;

/**
 * Append a share `?token=` to a workspace image URL so an anonymous
 * share-link viewer can fetch its bytes (the retrieval route accepts the token
 * — see `ApiV1ImageReadController`). Leaves everything else untouched:
 * `data:` / `blob:` / external URLs, and any URL that already carries a token.
 *
 * The stored `src` lives in the CRDT and is shared across every viewer plus
 * the author, so the token cannot be baked in at upload time; it is applied
 * per-viewer at render time via the slides/docs `setImageUrlResolver` seam.
 */
export function appendShareTokenToImageUrl(src: string, token: string): string {
  if (!token) return src;
  if (!WORKSPACE_IMAGE_RE.test(src)) return src;

  const hashIndex = src.indexOf("#");
  const hash = hashIndex >= 0 ? src.slice(hashIndex) : "";
  const base = hashIndex >= 0 ? src.slice(0, hashIndex) : src;
  if (/[?&]token=/.test(base)) return src;

  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}token=${encodeURIComponent(token)}${hash}`;
}
