import type { Document, DocumentType } from "@/types/documents";
import type { TestConnectionResult } from "@/types/datasource";
import type { MetricSeriesPoint } from "./analytics";
import { fetchWithAuth } from "./auth";
import { fetchDocuments } from "./documents";
import { assertOk } from "./http-error";
import { isOfflineUser, purgeOfflineDocuments } from "@/lib/offline-erase";
import { seg } from "./url";

const BASE = `${import.meta.env.VITE_BACKEND_API_URL}/workspaces`;

export interface Workspace {
  id: string;
  name: string;
  slug: string;
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
  const res = await fetchWithAuth(`${BASE}/${seg(id)}`);
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
  data: { name?: string; slug?: string },
): Promise<Workspace> {
  const res = await fetchWithAuth(`${BASE}/${seg(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  await assertOk(res, "Failed to update workspace");
  return res.json();
}

/**
 * The ids of every document this workspace holds, folders included.
 *
 * Asked *before* the access-ending request, because afterwards the server has
 * nothing to list. Best effort: this only feeds local cleanup, so a failure
 * leaves the thirty-day sweep to it rather than failing the operation.
 */
async function documentIdsIn(workspaceId: string): Promise<Array<string>> {
  try {
    const documents = await fetchDocuments();
    return documents
      .filter((document) => document.workspaceId === workspaceId)
      .map((document) => document.id);
  } catch {
    return [];
  }
}

/**
 * Deletes workspace.
 *
 * Its documents' local copies go with it. The design's cleanup rule is that
 * content must not outlive the authority to read it, and a deleted workspace
 * ends that authority exactly as a deleted document does — offline persistence
 * keeps a full copy, and nothing else would reach it before the thirty-day
 * sweep.
 */
export async function deleteWorkspace(id: string): Promise<void> {
  const doomed = await documentIdsIn(id);
  const res = await fetchWithAuth(`${BASE}/${seg(id)}`, {
    method: "DELETE",
  });
  await assertOk(res, "Failed to delete workspace");
  await purgeOfflineDocuments(doomed);
}

/**
 * Removes member from workspace.
 *
 * Losing membership is the other half of the same rule — but only for the
 * account whose documents this device holds. An owner removing *somebody else*
 * must purge nothing here: the store is scoped to whoever is signed in on this
 * machine, so purging then would delete this user's copies of documents they
 * still have every right to read. The removed member's own device cleans up
 * when they next open the app.
 */
export async function removeMember(
  workspaceId: string,
  userId: number,
): Promise<void> {
  const leaving = isOfflineUser(String(userId));
  const doomed = leaving ? await documentIdsIn(workspaceId) : [];
  const res = await fetchWithAuth(
    `${BASE}/${seg(workspaceId)}/members/${seg(String(userId))}`,
    { method: "DELETE" },
  );
  await assertOk(res, "Failed to remove member");
  await purgeOfflineDocuments(doomed);
}

/**
 * Creates workspace invite.
 */
export async function createInvite(
  workspaceId: string,
  data?: { role?: string; expiration?: string },
): Promise<WorkspaceInvite> {
  const res = await fetchWithAuth(`${BASE}/${seg(workspaceId)}/invites`, {
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
  const res = await fetchWithAuth(`${BASE}/${seg(workspaceId)}/invites`);
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
    `${BASE}/${seg(workspaceId)}/invites/${seg(inviteId)}`,
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
    `${import.meta.env.VITE_BACKEND_API_URL}/invites/${seg(token)}/accept`,
    { method: "POST" },
  );
  await assertOk(res, "Failed to accept invite");
  return res.json();
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  /**
   * The member who minted the key, and whose authority it carries. A member
   * only ever sees their own; an owner sees the whole workspace's, which is
   * the case this field is here to label.
   */
  createdBy: number;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

export interface ApiKeyCreateResponse {
  id: string;
  name: string;
  prefix: string;
  key: string;
}

/**
 * Fetches API keys for a workspace.
 */
export async function fetchApiKeys(workspaceId: string): Promise<ApiKey[]> {
  const res = await fetchWithAuth(`${BASE}/${seg(workspaceId)}/api-keys`);
  await assertOk(res, "Failed to fetch API keys");
  return res.json();
}

/**
 * Creates an API key for a workspace.
 */
export async function createApiKey(
  workspaceId: string,
  data: { name: string },
): Promise<ApiKeyCreateResponse> {
  const res = await fetchWithAuth(`${BASE}/${seg(workspaceId)}/api-keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  await assertOk(res, "Failed to create API key");
  return res.json();
}

/**
 * Revokes an API key.
 */
export async function revokeApiKey(
  workspaceId: string,
  keyId: string,
): Promise<void> {
  const res = await fetchWithAuth(`${BASE}/${seg(workspaceId)}/api-keys/${seg(keyId)}`, {
    method: "DELETE",
  });
  await assertOk(res, "Failed to revoke API key");
}

/**
 * Fetches workspace documents. Pass `folderId` to list a folder's contents;
 * omit it to list the workspace root.
 */
export async function fetchWorkspaceDocuments(
  workspaceId: string,
  folderId?: string | null,
): Promise<Document[]> {
  const qs = folderId ? `?folderId=${encodeURIComponent(folderId)}` : "";
  const res = await fetchWithAuth(`${BASE}/${seg(workspaceId)}/documents${qs}`);
  await assertOk(res, "Failed to fetch documents");
  return res.json();
}

export interface WorkspaceAnalytics {
  enabled: boolean;
  totalViews: number;
  uniqueVisitors: number;
  viewsByDay: MetricSeriesPoint[];
  byDocument: {
    documentId: string;
    title: string;
    views: number;
    uniqueVisitors: number;
    /** Whether the caller may open this document's (manager-gated) detail
     * dashboard. False rows must not be linked — they would 403. */
    canManage: boolean;
  }[];
}

/**
 * Whether the deployment has analytics configured (a StarRocks warehouse to
 * read from). Used to hide the Analytics nav entry when it is not.
 */
export async function fetchAnalyticsEnabled(): Promise<boolean> {
  const res = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/analytics/enabled`,
  );
  if (!res.ok) return false;
  const data = (await res.json()) as { enabled?: boolean };
  return Boolean(data.enabled);
}

/**
 * Fetches aggregated view analytics for a workspace (member-gated).
 */
export async function getWorkspaceAnalytics(
  workspaceId: string,
  range?: { from?: string; to?: string },
): Promise<WorkspaceAnalytics> {
  const qs = new URLSearchParams();
  if (range?.from) qs.set("from", range.from);
  if (range?.to) qs.set("to", range.to);
  const suffix = qs.toString() ? `?${qs}` : "";
  const res = await fetchWithAuth(`${BASE}/${seg(workspaceId)}/analytics${suffix}`);
  await assertOk(res, "Failed to load analytics");
  return res.json();
}

/**
 * Creates workspace document.
 */
export async function createWorkspaceDocument(
  workspaceId: string,
  data: {
    title: string;
    type?: DocumentType;
    fileId?: string;
    fileSize?: number;
    mimeType?: string;
    folderId?: string | null;
  },
) {
  const res = await fetchWithAuth(`${BASE}/${seg(workspaceId)}/documents`, {
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
  const res = await fetchWithAuth(`${BASE}/${seg(workspaceId)}/datasources`);
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
  const res = await fetchWithAuth(`${BASE}/${seg(workspaceId)}/datasources`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  await assertOk(res, "Failed to create datasource");
  return res.json();
}

/**
 * Tests workspace data source settings without saving them.
 */
export async function testWorkspaceDataSourceConfig(
  workspaceId: string,
  data: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    sslEnabled: boolean;
  },
): Promise<TestConnectionResult> {
  const res = await fetchWithAuth(`${BASE}/${seg(workspaceId)}/datasources/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  await assertOk(res, "Failed to test connection");
  return res.json();
}
