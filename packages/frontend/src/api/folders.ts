import type { Folder } from "@/types/documents";
import { fetchWithAuth } from "./auth";
import { assertOk } from "./http-error";
import { seg } from "./url";

/**
 * Fetches folders in a workspace.
 */
export async function fetchFolders(workspaceId: string): Promise<Folder[]> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/workspaces/${seg(workspaceId)}/folders`
  );
  await assertOk(response, "Couldn't load folders");
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
    `${import.meta.env.VITE_BACKEND_API_URL}/workspaces/${seg(workspaceId)}/folders`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  await assertOk(response, "Couldn't create the folder");

  return response.json();
}

/**
 * Renames folder.
 */
export async function renameFolder(id: string, name: string): Promise<Folder> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/folders/${seg(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }
  );

  await assertOk(response, "Couldn't rename the folder");

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
    `${import.meta.env.VITE_BACKEND_API_URL}/folders/${seg(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId }),
    }
  );

  await assertOk(response, "Couldn't move the folder");

  return response.json();
}

/**
 * Deletes folder.
 */
export async function deleteFolder(id: string): Promise<void> {
  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/folders/${seg(id)}`,
    {
      method: "DELETE",
    }
  );

  await assertOk(response, "Couldn't delete the folder");
}
