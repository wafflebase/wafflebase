import { fetchWithAuth } from "@/api/auth";
import type { MiroItemLike, MiroConnectorLike } from "@wafflebase/board";

export interface MiroImportNote {
  reason: string;
  itemType?: string;
  count: number;
}

export interface MiroImportResult {
  items: MiroItemLike[];
  connectors: MiroConnectorLike[];
  notes: MiroImportNote[];
}

/**
 * Best-effort extraction of a server-provided error message from a failed
 * response body, without touching `response.headers` — some callers (and
 * this module's own tests) hand back a bare `{ ok, status, json }` stub that
 * has no `Headers` object, which the shared `assertOk`/`readResponseErrorMessage`
 * helpers assume is always present (real `fetch()` responses always have one,
 * but a minimal test double may not).
 */
async function readErrorMessage(res: Response): Promise<string | null> {
  try {
    const body = await res.json();
    const message = (body as { message?: unknown } | null)?.message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  } catch {
    // Body wasn't JSON (or already consumed) — fall back to the generic message.
  }
  return null;
}

/**
 * Ask the backend to read a Miro board on the user's behalf.
 *
 * The token is sent once and used server-side only — it is never stored here,
 * never put in the URL (which would land in logs/history), and never written
 * into the document.
 */
export async function importMiroBoard(
  workspaceId: string,
  payload: { token: string; boardUrl: string },
): Promise<MiroImportResult> {
  const res = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/workspaces/${workspaceId}/miro/import`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new Error(message || "Failed to import the Miro board");
  }
  return res.json();
}
