import { fetchWithAuth } from "@/api/auth";
import { seg } from "@/api/url";

const BACKEND_BASE = import.meta.env.VITE_BACKEND_API_URL ?? "";

/**
 * There are two image spines, and an id from one **cannot** be read through
 * the other. Which one to upload through is decided by who has to see the
 * result, and getting it wrong stores an id that no route can serve:
 *
 * - {@link postWorkspaceImage} stores under `{workspaceId}/{id}` and is read
 *   back through the access-gated `GET /api/v1/workspaces/:wid/images/:id`
 *   (workspace member, workspace API key, or a share token). This is right for
 *   content *inside* a document — the reader always has one of those.
 * - {@link postSharedImage} stores at the bucket root and is read back through
 *   the unauthenticated, immutably cached {@link imageUrl}. This is right for
 *   anything a logged-out stranger must see, which today means template
 *   gallery thumbnails: a template card renders for a visitor who holds no
 *   workspace membership and no share token at all.
 */

/** Upload an image scoped to a workspace. See the note above. */
export async function postWorkspaceImage(
  file: File | Blob,
  workspaceId: string,
  filename?: string,
): Promise<{ id: string; url: string }> {
  return post(
    `${BACKEND_BASE}/api/v1/workspaces/${seg(workspaceId)}/images`,
    file,
    filename,
  );
}

/**
 * Upload an image on behalf of an **anonymous share-link editor**. Stores
 * under the workspace the token's document belongs to — the caller cannot name
 * a workspace, and the backend derives it from the link
 * (`ApiV1ShareImageUploadController`), so the result is read back through the
 * same gated route {@link postWorkspaceImage}'s ids are.
 *
 * Deliberately a plain `fetch`, not `fetchWithAuth` like everything else in
 * this module: an anonymous visitor has no session, so `fetchWithAuth`'s
 * recovery from a 401/403 — refresh, then `logout()` and navigate to `/login` —
 * would eject them from the document they were editing over a legitimate
 * authorization failure (issue #1037). `credentials: "include"` is still sent
 * so a *logged-in* visitor following the same share link is not treated
 * differently by any proxy in between; the backend authorizes on the token
 * either way.
 */
export async function postShareTokenImage(
  file: File | Blob,
  token: string,
  filename?: string,
): Promise<{ id: string; url: string }> {
  return post(
    `${BACKEND_BASE}/api/v1/shared/images?token=${encodeURIComponent(token)}`,
    file,
    filename,
    { authenticated: false },
  );
}

/** Upload an image anyone can read by id. See the note above. */
export async function postSharedImage(
  file: File | Blob,
  filename?: string,
): Promise<{ id: string; url: string }> {
  return post(`${BACKEND_BASE}/images`, file, filename);
}

/**
 * Where `GET /images/:id` serves an id from {@link postSharedImage}.
 *
 * Unauthenticated and immutably cached, which is what lets a logged-out
 * visitor see a template card. Shared by the gallery and the landing page so
 * the two cannot drift.
 */
export function imageUrl(id: string): string {
  return `${BACKEND_BASE}/images/${encodeURIComponent(id)}`;
}

/**
 * The origin the API serves images from, for
 * `setCredentialedImageOrigins`.
 *
 * Empty string when `VITE_BACKEND_API_URL` is unset — a same-origin
 * deployment, where a canvas is never tainted in the first place and there is
 * nothing to declare.
 */
export function backendOrigin(): string {
  if (!BACKEND_BASE) return "";
  try {
    return new URL(BACKEND_BASE, window.location.href).origin;
  } catch {
    return "";
  }
}

async function post(
  url: string,
  file: File | Blob,
  filename?: string,
  { authenticated = true }: { authenticated?: boolean } = {},
): Promise<{ id: string; url: string }> {
  const formData = new FormData();
  // With a `filename` the platform rewraps the value into a fresh `File`, so
  // it is passed only when the caller has one to give. Not for the server's
  // benefit — `ImageService.upload` derives the stored extension from the
  // validated MIME type and ignores the filename entirely — but because a
  // multipart part with no name is harder to read in a log or a proxy, and
  // because rewrapping an already-named `File` would break callers that
  // compare identity.
  if (filename) formData.append("file", file, filename);
  else formData.append("file", file);

  const init: RequestInit = { method: "POST", body: formData };
  const res = authenticated
    ? await fetchWithAuth(url, init)
    : await fetch(url, { ...init, credentials: "include" });
  if (!res.ok) {
    throw new Error(`Upload failed: ${await failureText(res)}`);
  }
  return (await res.json()) as { id: string; url: string };
}

/**
 * The refusal in the terms the user is shown it. Every message here reaches a
 * toast (`insertImageFromFile`), and a Nest exception body is JSON — so the
 * raw text put `{"message":"This share link is read-only","statusCode":403}`
 * in front of the user. Falls back to the whole body for anything that is not
 * a Nest error shape.
 */
async function failureText(res: Response): Promise<string> {
  const body = await res.text();
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed?.message === "string") return parsed.message;
  } catch {
    // Not JSON — fall through to the raw body.
  }
  return body;
}
