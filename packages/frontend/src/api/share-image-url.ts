/** Workspace-image path, matched against a URL's pathname (unanchored so a
 * deployment that mounts the backend under a path prefix still matches). */
const WORKSPACE_IMAGE_PATH_RE =
  /\/api\/v1\/workspaces\/[^/]+\/images\/[^/?#]+/;

/** Configured backend origin, or null when same-origin / unset. Read at call
 * time (not module load) so tests can stub `VITE_BACKEND_API_URL`. */
function backendOrigin(): string | null {
  const base = import.meta.env.VITE_BACKEND_API_URL ?? "";
  if (!base) return null;
  try {
    return new URL(base, "http://localhost").origin;
  } catch {
    return null;
  }
}

/**
 * True only for a URL that will actually hit our own backend's workspace-image
 * route: a root-relative path (same origin as the app), or an absolute URL
 * whose origin is the configured backend origin. This gate is a SECURITY
 * boundary: `data.src` comes from the CRDT and a malicious collaborator can set
 * it to `https://attacker.example/api/v1/workspaces/w/images/x.png`; without
 * the origin check we would append the viewer's share token and leak it to that
 * host.
 */
function isTrustedWorkspaceImageUrl(src: string): boolean {
  if (src.startsWith("/")) {
    // Root-relative → resolves against the app's own origin. Safe.
    return WORKSPACE_IMAGE_PATH_RE.test(src.split(/[?#]/, 1)[0]);
  }
  const origin = backendOrigin();
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  return WORKSPACE_IMAGE_PATH_RE.test(url.pathname);
}

/**
 * Append a share `?token=` to a workspace image URL so an anonymous
 * share-link viewer can fetch its bytes (the retrieval route accepts the token
 * — see `ApiV1ImageReadController`). Only URLs that hit our own backend are
 * tokened (see `isTrustedWorkspaceImageUrl`); `data:` / `blob:` / foreign
 * absolute URLs, and any URL that already carries a token, are left untouched.
 *
 * The stored `src` lives in the CRDT and is shared across every viewer plus
 * the author, so the token cannot be baked in at upload time; it is applied
 * per-viewer at render time via the slides `setImageUrlResolver` seam.
 */
export function appendShareTokenToImageUrl(src: string, token: string): string {
  if (!token) return src;
  if (!isTrustedWorkspaceImageUrl(src)) return src;

  const hashIndex = src.indexOf("#");
  const hash = hashIndex >= 0 ? src.slice(hashIndex) : "";
  const base = hashIndex >= 0 ? src.slice(0, hashIndex) : src;
  if (/[?&]token=/.test(base)) return src;

  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}token=${encodeURIComponent(token)}${hash}`;
}
