import type { DocStyles } from "@wafflebase/docs";
import { fetchWithAuth } from "./auth";

/**
 * Per-user "default document styles" — the Google Docs "Save as my default
 * styles" blob. Backed by `GET/PUT /auth/me/doc-styles`.
 */

export async function fetchMyDocStyles(): Promise<DocStyles> {
  const res = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/auth/me/doc-styles`,
    { method: "GET", credentials: "include" }
  );
  if (!res.ok) {
    throw new Error("Failed to load default styles");
  }
  const body = (await res.json()) as { styles?: DocStyles };
  return body.styles ?? {};
}

export async function saveMyDocStyles(styles: DocStyles): Promise<void> {
  const res = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/auth/me/doc-styles`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ styles }),
    }
  );
  if (!res.ok) {
    throw new Error("Failed to save default styles");
  }
}
