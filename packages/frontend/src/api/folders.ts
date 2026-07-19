import type { Folder } from "@/types/documents";
import { fetchWithAuth } from "./auth";
import { assertOk } from "./http-error";

/**
 * Fetches folders in a workspace.
 */
export async function fetchFolders(workspaceId: string): Promise<Folder[]> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/workspaces/${workspaceId}/folders`
  );
  await assertOk(response, "Failed to fetch folders");
  return response.json();
}

/**
 * Creates a folder in a workspace.
 */
export async function createFolder(
  workspaceId: string,
  payload: { name: string; parentId?: string | null }
): Promise<Folder> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/workspaces/${workspaceId}/folders`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  await assertOk(response, "Failed to create folder");

  return response.json();
}

/**
 * Renames folder.
 */
export async function renameFolder(id: string, name: string): Promise<Folder> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/folders/${id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }
  );

  await assertOk(response, "Failed to rename folder");

  return response.json();
}

/**
 * Moves folder to another parent folder (or to the workspace root when
 * `parentId` is null).
 */
export async function moveFolder(
  id: string,
  parentId: string | null
): Promise<Folder> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/folders/${id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId }),
    }
  );

  await assertOk(response, "Failed to move folder");

  return response.json();
}

/**
 * Deletes folder.
 */
export async function deleteFolder(id: string): Promise<void> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/folders/${id}`,
    {
      method: "DELETE",
    }
  );

  await assertOk(response, "Failed to delete folder");
}
