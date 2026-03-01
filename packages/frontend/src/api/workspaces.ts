import { fetchWithAuth } from "./auth";
import { assertOk } from "./http-error";

const BASE = `${import.meta.env.VITE_BACKEND_API_URL}/workspaces`;

export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
}

export interface WorkspaceMember {
  id: string;
  role: string;
  joinedAt: string;
  user: { id: number; username: string; email: string; photo?: string };
}

export interface WorkspaceDetail extends Workspace {
  members: WorkspaceMember[];
}

export interface WorkspaceInvite {
  id: string;
  token: string;
  role: string;
  createdAt: string;
  expiresAt: string | null;
}

/**
 * Fetches workspaces.
 */
export async function fetchWorkspaces(): Promise<Workspace[]> {
  const res = await fetchWithAuth(BASE);
  await assertOk(res, "Failed to fetch workspaces");
  return res.json();
}

/**
 * Fetches workspace.
 */
export async function fetchWorkspace(id: string): Promise<WorkspaceDetail> {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  await assertOk(res, "Failed to fetch workspace");
  return res.json();
}

/**
 * Creates workspace.
 */
export async function createWorkspace(data: {
  name: string;
}): Promise<Workspace> {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  await assertOk(res, "Failed to create workspace");
  return res.json();
}

/**
 * Updates workspace.
 */
export async function updateWorkspace(
  id: string,
  data: { name: string },
): Promise<Workspace> {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  await assertOk(res, "Failed to update workspace");
  return res.json();
}

/**
 * Deletes workspace.
 */
export async function deleteWorkspace(id: string): Promise<void> {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "DELETE",
  });
  await assertOk(res, "Failed to delete workspace");
}

/**
 * Removes member from workspace.
 */
export async function removeMember(
  workspaceId: string,
  userId: number,
): Promise<void> {
  const res = await fetchWithAuth(
    `${BASE}/${workspaceId}/members/${userId}`,
    { method: "DELETE" },
  );
  await assertOk(res, "Failed to remove member");
}

/**
 * Creates workspace invite.
 */
export async function createInvite(
  workspaceId: string,
  data?: { role?: string; expiration?: string },
): Promise<WorkspaceInvite> {
  const res = await fetchWithAuth(`${BASE}/${workspaceId}/invites`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data || {}),
  });
  await assertOk(res, "Failed to create invite");
  return res.json();
}

/**
 * Fetches workspace invites.
 */
export async function fetchInvites(
  workspaceId: string,
): Promise<WorkspaceInvite[]> {
  const res = await fetchWithAuth(`${BASE}/${workspaceId}/invites`);
  await assertOk(res, "Failed to fetch invites");
  return res.json();
}

/**
 * Revokes workspace invite.
 */
export async function revokeInvite(
  workspaceId: string,
  inviteId: string,
): Promise<void> {
  const res = await fetchWithAuth(
    `${BASE}/${workspaceId}/invites/${inviteId}`,
    { method: "DELETE" },
  );
  await assertOk(res, "Failed to revoke invite");
}

/**
 * Accepts workspace invite.
 */
export async function acceptInvite(
  token: string,
): Promise<{ workspaceId: string }> {
  const res = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/invites/${token}/accept`,
    { method: "POST" },
  );
  await assertOk(res, "Failed to accept invite");
  return res.json();
}

/**
 * Fetches workspace documents.
 */
export async function fetchWorkspaceDocuments(workspaceId: string) {
  const res = await fetchWithAuth(`${BASE}/${workspaceId}/documents`);
  await assertOk(res, "Failed to fetch documents");
  return res.json();
}

/**
 * Creates workspace document.
 */
export async function createWorkspaceDocument(
  workspaceId: string,
  data: { title: string },
) {
  const res = await fetchWithAuth(`${BASE}/${workspaceId}/documents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  await assertOk(res, "Failed to create document");
  return res.json();
}

/**
 * Fetches workspace data sources.
 */
export async function fetchWorkspaceDataSources(workspaceId: string) {
  const res = await fetchWithAuth(`${BASE}/${workspaceId}/datasources`);
  await assertOk(res, "Failed to fetch datasources");
  return res.json();
}

/**
 * Creates workspace data source.
 */
export async function createWorkspaceDataSource(
  workspaceId: string,
  data: Record<string, unknown>,
) {
  const res = await fetchWithAuth(`${BASE}/${workspaceId}/datasources`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  await assertOk(res, "Failed to create datasource");
  return res.json();
}
