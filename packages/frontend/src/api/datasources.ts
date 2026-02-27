import { fetchWithAuth } from "./auth";
import { assertOk } from "./http-error";
import type {
  DataSource,
  QueryResult,
  TestConnectionResult,
} from "@/types/datasource";

const BASE = `${import.meta.env.VITE_BACKEND_API_URL}/datasources`;

/**
 * Creates data source.
 */
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
  await assertOk(res, "Failed to create datasource");
  return res.json();
}

/**
 * Fetches data sources.
 */
export async function fetchDataSources(): Promise<DataSource[]> {
  const res = await fetchWithAuth(BASE);
  await assertOk(res, "Failed to fetch datasources");
  return res.json();
}

/**
 * Fetches data source.
 */
export async function fetchDataSource(id: string): Promise<DataSource> {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  await assertOk(res, "Failed to fetch datasource");
  return res.json();
}

/**
 * Updates data source.
 */
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
  await assertOk(res, "Failed to update datasource");
  return res.json();
}

/**
 * Deletes data source.
 */
export async function deleteDataSource(id: string): Promise<void> {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "DELETE",
  });
  await assertOk(res, "Failed to delete datasource");
}

/**
 * Tests data source connection.
 */
export async function testDataSourceConnection(
  id: string
): Promise<TestConnectionResult> {
  const res = await fetchWithAuth(`${BASE}/${id}/test`, {
    method: "POST",
  });
  await assertOk(res, "Failed to test connection");
  return res.json();
}

/**
 * Executes data source query.
 */
export async function executeDataSourceQuery(
  id: string,
  query: string
): Promise<QueryResult> {
  const res = await fetchWithAuth(`${BASE}/${id}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  await assertOk(res, "Query execution failed");
  return res.json();
}
