import { fetchWithAuth } from "./auth";
import type {
  DataSource,
  QueryResult,
  TestConnectionResult,
} from "@/types/datasource";

const BASE = `${import.meta.env.VITE_BACKEND_API_URL}/datasources`;

export async function createDataSource(payload: {
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslEnabled: boolean;
}): Promise<DataSource> {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to create datasource");
  return res.json();
}

export async function fetchDataSources(): Promise<DataSource[]> {
  const res = await fetchWithAuth(BASE);
  if (!res.ok) throw new Error("Failed to fetch datasources");
  return res.json();
}

export async function fetchDataSource(id: string): Promise<DataSource> {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  if (!res.ok) throw new Error("Failed to fetch datasource");
  return res.json();
}

export async function updateDataSource(
  id: string,
  payload: Partial<{
    name: string;
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    sslEnabled: boolean;
  }>
): Promise<DataSource> {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to update datasource");
  return res.json();
}

export async function deleteDataSource(id: string): Promise<void> {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete datasource");
}

export async function testDataSourceConnection(
  id: string
): Promise<TestConnectionResult> {
  const res = await fetchWithAuth(`${BASE}/${id}/test`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to test connection");
  return res.json();
}

export async function executeDataSourceQuery(
  id: string,
  query: string
): Promise<QueryResult> {
  const res = await fetchWithAuth(`${BASE}/${id}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || "Query execution failed");
  }
  return res.json();
}
