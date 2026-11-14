import { fetchWithAuth } from "./auth";
import { assertOk } from "./http-error";
import { seg } from "./url";
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
  await assertOk(res, "Couldn't create the data source");
  return res.json();
}

/**
 * Fetches data sources.
 */
export async function fetchDataSources(): Promise<DataSource[]> {
  const res = await fetchWithAuth(BASE);
  await assertOk(res, "Couldn't load data sources");
  return res.json();
}

/**
 * Fetches data source.
 */
export async function fetchDataSource(id: string): Promise<DataSource> {
  const res = await fetchWithAuth(`${BASE}/${seg(id)}`);
  await assertOk(res, "Couldn't load the data source");
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
  const res = await fetchWithAuth(`${BASE}/${seg(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await assertOk(res, "Couldn't update the data source");
  return res.json();
}

/**
 * Deletes data source.
 */
export async function deleteDataSource(id: string): Promise<void> {
  const res = await fetchWithAuth(`${BASE}/${seg(id)}`, {
    method: "DELETE",
  });
  await assertOk(res, "Couldn't delete the data source");
}

/**
 * Tests data source connection.
 */
export async function testDataSourceConnection(
  id: string
): Promise<TestConnectionResult> {
  const res = await fetchWithAuth(`${BASE}/${seg(id)}/test`, {
    method: "POST",
  });
  await assertOk(res, "Couldn't test the connection");
  return res.json();
}

/**
 * Executes data source query.
 */
export async function executeDataSourceQuery(
  id: string,
  query: string
): Promise<QueryResult> {
  const res = await fetchWithAuth(`${BASE}/${seg(id)}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  await assertOk(res, "Query execution failed");
  return res.json();
}
