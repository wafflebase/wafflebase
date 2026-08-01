import { fetchWithAuth } from "@/api/auth";
import { assertOk } from "@/api/http-error";
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
  await assertOk(res, "Failed to import the Miro board");
  return res.json();
}
