/** Supported open table formats. A caller supplies a structured reference, never SQL. */
export type LakehouseFormat = 'iceberg' | 'delta';

/** Object-storage backends understood by DuckDB's extension secrets. */
export type LakehouseStorageKind =
  | 'local'
  | 's3'
  | 's3-compatible'
  | 'gcs'
  | 'azure';

interface ScopedStorageCredentials {
  /** A trailing-slash table root used to scope DuckDB credentials. */
  scope: string;
}

export interface LocalStorageCredentials extends ScopedStorageCredentials {
  kind: 'local';
}

export interface S3StorageCredentials extends ScopedStorageCredentials {
  kind: 's3';
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  sessionToken?: string;
}

export interface S3CompatibleStorageCredentials
  extends ScopedStorageCredentials {
  kind: 's3-compatible';
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  region: string;
  /** False for a local MinIO development endpoint. */
  useSsl: boolean;
  sessionToken?: string;
}

/** GCS interoperable (HMAC) credentials, not a Google OAuth token. */
export interface GcsStorageCredentials extends ScopedStorageCredentials {
  kind: 'gcs';
  accessKeyId: string;
  secretAccessKey: string;
  /** Custom interop endpoint (schema: "MinIO/R2/GCS-interop"); default is storage.googleapis.com. */
  endpoint?: string;
  useSsl?: boolean;
}

export interface AzureStorageCredentials extends ScopedStorageCredentials {
  kind: 'azure';
  /** Azure's DuckDB CONFIG secret uses the complete account connection string. */
  connectionString: string;
}

export type LakehouseStorageCredentials =
  | LocalStorageCredentials
  | S3StorageCredentials
  | S3CompatibleStorageCredentials
  | GcsStorageCredentials
  | AzureStorageCredentials;

/** A trusted, structured table reference persisted by the API; it has no SQL field. */
export interface LakehouseTableRef {
  format: LakehouseFormat;
  storage: LakehouseStorageKind;
  path: string;
}

export type LakehouseTimeTravel =
  | { kind: 'version'; version: number }
  | { kind: 'snapshot'; snapshotId: string };

/**
 * API-level time-travel point. A `timestamp` never reaches a query plan: the
 * service resolves it to the commit at-or-before that instant via the history
 * listing, so plans only ever see the two concrete kinds above.
 */
export type LakehouseTimeTravelPoint =
  | LakehouseTimeTravel
  | { kind: 'timestamp'; iso: string };

/** Catalog-mode table coordinates (namespace levels + table), no SQL. */
export interface LakehouseCatalogTableRef {
  namespace: string[];
  table: string;
}

/** One row of GET /lakehouse-sources/:id/tables. */
export interface LakehouseCatalogTable {
  namespace: string[];
  table: string;
}

export interface LakehouseHistoryEntry {
  ref: LakehouseTimeTravel;
  timestamp?: string;
  operation?: string;
  summary?: Record<string, LakehouseCellValue>;
}

export type LakehouseCellValue =
  | string
  | number
  | boolean
  | null
  | LakehouseCellValue[]
  | { [key: string]: LakehouseCellValue };

/** Deliberately mirrors the existing datasource response envelope. */
export interface LakehouseQueryResponse {
  columns: Array<{ name: string; dataTypeID: number }>;
  rows: Array<Record<string, LakehouseCellValue>>;
  rowCount: number;
  truncated: boolean;
  executionTime: number;
}

/** A single statement suitable for DuckDB Node Neo's runAndReadAll(sql, values). */
export interface LakehouseSqlStatement {
  sql: string;
  values: readonly (string | number | boolean | bigint)[];
}

/** Setup/read/cleanup is split because Delta time travel requires ATTACH/DETACH. */
export interface LakehouseReadPlan {
  setup: readonly LakehouseSqlStatement[];
  read: LakehouseSqlStatement;
  cleanup: readonly LakehouseSqlStatement[];
}

export interface LakehouseSecretPlan {
  name: string;
  /** Trailing-slash table root used to constrain credential selection. */
  scope: string;
  create: LakehouseSqlStatement;
  cleanup: LakehouseSqlStatement;
}
