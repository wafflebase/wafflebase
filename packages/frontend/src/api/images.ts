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

  const res = await fetchWithAuth(url, { method: "POST", body: formData });
  if (!res.ok) {
    throw new Error(`Upload failed: ${await res.text()}`);
  }
  return (await res.json()) as { id: string; url: string };
}
