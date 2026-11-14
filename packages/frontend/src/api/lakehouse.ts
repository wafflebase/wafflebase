import { fetchWithAuth } from '@/api/auth';
import { assertOk } from '@/api/http-error';
import type {
  CreateLakehouseSourceInput,
  LakehouseHistoryEntry,
  LakehouseHistoryRef,
  LakehouseReadResult,
  LakehouseSource,
  LakehouseTestResult,
  UpdateLakehouseSourceInput,
} from '@/types/lakehouse';

const API_BASE = import.meta.env.VITE_BACKEND_API_URL ?? '';
const SOURCE_BASE = `${API_BASE}/lakehouse-sources`;

function sourceUrl(id: string): string {
  return `${SOURCE_BASE}/${encodeURIComponent(id)}`;
}

export async function fetchWorkspaceLakehouseSources(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<LakehouseSource[]> {
  const res = await fetchWithAuth(
    `${API_BASE}/workspaces/${encodeURIComponent(workspaceId)}/lakehouse-sources`,
    { signal },
  );
  await assertOk(res, "Couldn't load lakehouse connections");
  return res.json();
}

export async function createWorkspaceLakehouseSource(
  workspaceId: string,
  payload: CreateLakehouseSourceInput,
): Promise<LakehouseSource> {
  const res = await fetchWithAuth(
    `${API_BASE}/workspaces/${encodeURIComponent(workspaceId)}/lakehouse-sources`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  await assertOk(res, "Couldn't create the lakehouse connection");
  return res.json();
}

export async function fetchLakehouseSource(
  id: string,
  signal?: AbortSignal,
): Promise<LakehouseSource> {
  const res = await fetchWithAuth(sourceUrl(id), { signal });
  await assertOk(res, "Couldn't load the lakehouse connection");
  return res.json();
}

export async function updateLakehouseSource(
  id: string,
  payload: UpdateLakehouseSourceInput,
): Promise<LakehouseSource> {
  const res = await fetchWithAuth(sourceUrl(id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  await assertOk(res, "Couldn't update the lakehouse connection");
  return res.json();
}

export async function deleteLakehouseSource(id: string): Promise<void> {
  const res = await fetchWithAuth(sourceUrl(id), { method: 'DELETE' });
  await assertOk(res, "Couldn't delete the lakehouse connection");
}

export async function testWorkspaceLakehouseSource(
  workspaceId: string,
  payload: CreateLakehouseSourceInput,
  signal?: AbortSignal,
): Promise<LakehouseTestResult> {
  const res = await fetchWithAuth(
    `${API_BASE}/workspaces/${encodeURIComponent(workspaceId)}/lakehouse-sources/test`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    },
  );
  await assertOk(res, "Couldn't test the lakehouse connection");
  return res.json();
}

export async function testLakehouseSource(
  id: string,
  payload?: UpdateLakehouseSourceInput,
  signal?: AbortSignal,
): Promise<LakehouseTestResult> {
  const res = await fetchWithAuth(`${sourceUrl(id)}/test`, {
    method: 'POST',
    ...(payload
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      : {}),
    signal,
  });
  await assertOk(res, "Couldn't test the lakehouse connection");
  return res.json();
}

export async function fetchLakehouseHistory(
  id: string,
  signal?: AbortSignal,
): Promise<LakehouseHistoryEntry[]> {
  const res = await fetchWithAuth(`${sourceUrl(id)}/history`, { signal });
  await assertOk(res, "Couldn't load the commit history");
  return res.json();
}

export async function readLakehouseSource(
  id: string,
  asOf?: LakehouseHistoryRef,
  signal?: AbortSignal,
): Promise<LakehouseReadResult> {
  const res = await fetchWithAuth(`${sourceUrl(id)}/read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(asOf ? { asOf } : {}),
    signal,
  });
  await assertOk(res, "Couldn't read the lakehouse table");
  return res.json();
}
