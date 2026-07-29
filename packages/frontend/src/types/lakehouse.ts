import type { QueryResult } from '@/types/datasource';
import type { TimeTravelPoint } from '@/types/worksheet';

export type LakehouseFormat = 'iceberg' | 'delta';

export type LakehouseStorage =
  | 'local'
  | 's3'
  | 's3-compatible'
  | 'gcs'
  | 'azure';

export type LakehouseCredentials = {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  accountName?: string;
  accountKey?: string;
  connectionString?: string;
  sasToken?: string;
};

export type LakehouseSource = {
  id: string;
  name: string;
  format: LakehouseFormat;
  storage: LakehouseStorage;
  endpoint?: string | null;
  region?: string | null;
  bucket?: string | null;
  basePath: string;
  credentials: string;
  workspaceId: string;
  authorID?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type CreateLakehouseSourceInput = {
  name: string;
  format: LakehouseFormat;
  storage: LakehouseStorage;
  endpoint?: string | null;
  region?: string | null;
  bucket?: string | null;
  basePath: string;
  credentials: LakehouseCredentials;
};

export type UpdateLakehouseSourceInput = Partial<CreateLakehouseSourceInput>;

export type LakehouseTestResult = {
  success: boolean;
  error?: string;
};

export type LakehouseHistoryRef = Extract<
  TimeTravelPoint,
  { kind: 'version' | 'snapshot' }
>;

export type LakehouseHistoryEntry = {
  ref: LakehouseHistoryRef;
  timestamp?: string;
  operation?: string;
  summary?: Record<string, unknown>;
};

export type LakehouseReadResult = QueryResult;

const QUALIFIED_URI_PATTERN = /^([a-z][a-z0-9+.-]*):\/\//i;
const GLOB_PATTERN = /[*?[\]{}]/;

function getUnsafePathError(path: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return 'Table paths cannot contain invalid percent encoding.';
  }
  if (
    [...decoded].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  ) {
    return 'Table paths cannot contain control characters.';
  }
  if (decoded.split('/').some((segment) => segment === '..')) {
    return 'Table paths cannot contain parent-directory segments.';
  }
  if (GLOB_PATTERN.test(path)) {
    return 'Table paths cannot contain glob metacharacters.';
  }
  return undefined;
}

function getObjectUriError(
  storage: Exclude<LakehouseStorage, 'local'>,
  path: string,
): string | undefined {
  let uri: URL;
  try {
    uri = new URL(path);
  } catch {
    return 'Object-storage paths must be valid absolute URIs.';
  }

  const supportedProtocols =
    storage === 'gcs'
      ? ['gcs:', 'gs:']
      : storage === 'azure'
        ? ['az:']
        : ['s3:'];
  if (!supportedProtocols.includes(uri.protocol)) {
    return `${storage} paths must use ${supportedProtocols
      .map((value) => `${value}//`)
      .join(' or ')}.`;
  }
  if (
    !uri.hostname ||
    uri.username ||
    uri.password ||
    uri.port ||
    uri.search ||
    uri.hash
  ) {
    return 'Object-storage paths cannot include credentials, a port, query, or fragment.';
  }
  return undefined;
}

export function isLakehouseHistoryRef(
  value: unknown,
): value is LakehouseHistoryRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const point = value as Record<string, unknown>;
  const keys = Object.keys(point).sort().join(',');
  if (point.kind === 'version') {
    return (
      keys === 'kind,version' &&
      Number.isSafeInteger(point.version) &&
      (point.version as number) >= 0
    );
  }
  if (point.kind !== 'snapshot') return false;

  const snapshotId = point.snapshotId;
  return (
    keys === 'kind,snapshotId' &&
    typeof snapshotId === 'string' &&
    snapshotId.length <= 19 &&
    /^(0|[1-9][0-9]*)$/.test(snapshotId) &&
    BigInt(snapshotId) <= 9_223_372_036_854_775_807n
  );
}

export function lakehouseHistoryRefKey(
  value: LakehouseHistoryRef | undefined,
): string {
  if (!value) return 'latest';
  return value.kind === 'version'
    ? `version:${value.version}`
    : `snapshot:${value.snapshotId}`;
}

export function getLakehouseSourcePathError({
  format,
  storage,
  bucket,
  basePath,
}: Pick<
  CreateLakehouseSourceInput,
  'format' | 'storage' | 'bucket' | 'basePath'
>): string | undefined {
  const path = basePath.trim();
  if (!path) return undefined;
  const unsafePathError = getUnsafePathError(path);
  if (unsafePathError) return unsafePathError;
  if (format === 'iceberg' && !path.endsWith('.metadata.json')) {
    return 'Iceberg requires a .metadata.json metadata file.';
  }
  if (
    format === 'delta' &&
    (path.includes('/_delta_log/') || path.endsWith('/_delta_log'))
  ) {
    return 'Delta requires the table root, not its _delta_log directory.';
  }

  if (storage === 'local') {
    if (path.startsWith('/')) return undefined;
    if (path.startsWith('file:///')) {
      try {
        const uri = new URL(path);
        if (!uri.hostname && !uri.search && !uri.hash) return undefined;
      } catch {
        // Fall through to the stable local-path validation message.
      }
    }
    return 'Local tables require an absolute server path or file:/// URI.';
  }

  const protocol = path.match(QUALIFIED_URI_PATTERN)?.[1]?.toLowerCase();
  if (bucket?.trim()) {
    if (protocol) {
      return 'Use a relative table path when a bucket or container is set.';
    }
    const scheme =
      storage === 'gcs' ? 'gcs' : storage === 'azure' ? 'az' : 's3';
    return getObjectUriError(
      storage,
      `${scheme}://${bucket.trim()}/${path.replace(/^\/+/, '')}`,
    );
  }
  if (!protocol) {
    return 'Set a bucket or enter a fully-qualified object-storage URI.';
  }

  return getObjectUriError(storage, path);
}

export function getLakehouseEndpointError(
  storage: LakehouseStorage,
  endpoint: string,
): string | undefined {
  const value = endpoint.trim();
  const usesEndpoint = storage === 's3-compatible' || storage === 'azure';
  if (!usesEndpoint) return undefined;
  if (!value) {
    return storage === 's3-compatible'
      ? 'S3-compatible storage requires an HTTP(S) endpoint.'
      : undefined;
  }

  let uri: URL;
  try {
    uri = new URL(value);
  } catch {
    return 'Endpoint must include http:// or https://.';
  }
  if (
    !['http:', 'https:'].includes(uri.protocol) ||
    uri.username ||
    uri.password ||
    uri.search ||
    uri.hash
  ) {
    return 'Endpoint must be an HTTP(S) URL without credentials, query, or fragment.';
  }
  if (
    storage === 's3-compatible' &&
    uri.pathname !== '' &&
    uri.pathname !== '/'
  ) {
    return 'S3-compatible endpoints cannot include a path.';
  }
  if (storage === 'azure' && value.includes(';')) {
    return 'Azure endpoints cannot contain semicolons.';
  }
  return undefined;
}

export function getLakehouseCredentialsError(
  storage: LakehouseStorage,
  credentials: LakehouseCredentials,
  canMergeStoredCredentials: boolean,
): string | undefined {
  if (storage === 'local') return undefined;

  if (storage === 'azure') {
    const connectionString = credentials.connectionString?.trim();
    const accountName = credentials.accountName?.trim();
    const accountKey = credentials.accountKey;
    const sasToken = credentials.sasToken;
    if (connectionString && (accountName || accountKey || sasToken)) {
      return 'Use an Azure connection string by itself, without account credentials.';
    }
    if (accountKey && sasToken) {
      return 'Use either an Azure account key or a SAS token, not both.';
    }
    if (canMergeStoredCredentials && accountName && !accountKey && !sasToken) {
      return 'Changing an Azure account name requires a fresh account key or SAS token.';
    }
    if (canMergeStoredCredentials) return undefined;
    if (connectionString || (accountName && (accountKey || sasToken))) {
      return undefined;
    }
    return 'Azure requires a connection string or an account name with an account key or SAS token.';
  }

  const accessKeyId = credentials.accessKeyId?.trim();
  const secretAccessKey = credentials.secretAccessKey?.trim();
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
    return 'Access key and secret key must be rotated together.';
  }
  if (accessKeyId && secretAccessKey) return undefined;
  if (canMergeStoredCredentials) return undefined;
  return `${storage} requires both an access key and a secret key.`;
}
