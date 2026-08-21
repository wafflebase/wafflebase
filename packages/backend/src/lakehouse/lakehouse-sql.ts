import { LakehouseStorageKind } from './lakehouse.types';

const OBJECT_URI_PREFIX: Record<
  Exclude<LakehouseStorageKind, 'local'>,
  readonly string[]
> = {
  s3: ['s3:'],
  's3-compatible': ['s3:'],
  gcs: ['gcs:', 'gs:'],
  azure: ['az:'],
};

function assertSafeText(value: string, label: string): void {
  const hasControlCharacter = [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (!value || hasControlCharacter) {
    throw new Error(
      `${label} must be non-empty and cannot contain control characters`,
    );
  }
}

function assertNoTraversal(path: string, label: string): void {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new Error(`${label} contains invalid percent encoding`);
  }
  assertSafeText(decoded, label);

  if (decoded.split('/').some((segment) => segment === '..')) {
    throw new Error(`${label} cannot contain a parent-directory segment`);
  }
}

/** Quotes a value for the rare DuckDB grammar position that cannot be bound. */
export function escapeSqlLiteral(value: string): string {
  assertSafeText(value, 'SQL literal');
  return `'${value.replace(/'/g, "''")}'`;
}

/** Quotes any SQL identifier while rejecting control characters. */
export function escapeSqlIdentifier(value: string): string {
  assertSafeText(value, 'SQL identifier');
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Accept only the path forms this connector deliberately supports. Values are
 * later bound as parameters, but validation also prevents a secret from being
 * scoped to an unintended URI or parent directory.
 */
export function validateLakehousePath(
  storage: LakehouseStorageKind,
  path: string,
): void {
  assertSafeText(path, 'Lakehouse path');
  assertNoTraversal(path, 'Lakehouse path');
  assertNoGlobCharacters(path);

  if (storage === 'local') {
    if (path.startsWith('/')) return;
    if (path.startsWith('file:///')) {
      try {
        const uri = new URL(path);
        if (
          uri.protocol === 'file:' &&
          !uri.hostname &&
          !uri.username &&
          !uri.password &&
          !uri.search &&
          !uri.hash
        ) {
          return;
        }
      } catch {
        // Fall through to the stable validation error below.
      }
    }
    throw new Error(
      'Local lakehouse paths must be absolute paths or file:/// URIs',
    );
  }

  let uri: URL;
  try {
    uri = new URL(path);
  } catch {
    throw new Error(`${storage} lakehouse paths must be absolute URIs`);
  }

  const protocols = OBJECT_URI_PREFIX[storage];
  if (!protocols.includes(uri.protocol)) {
    throw new Error(
      `${storage} lakehouse paths must use ${protocols
        .map((protocol) => `${protocol}//`)
        .join(' or ')}`,
    );
  }
  if (!uri.hostname || uri.username || uri.password || uri.search || uri.hash) {
    throw new Error(
      `${storage} lakehouse paths must not include credentials, query, or fragment`,
    );
  }
}

/** A MinIO endpoint is host[:port], never a URL with credentials or a path. */
export function validateS3CompatibleEndpoint(endpoint: string): void {
  assertSafeText(endpoint, 'S3-compatible endpoint');
  if (!/^[a-zA-Z0-9.-]+(?::[1-9][0-9]{0,4})?$/.test(endpoint)) {
    throw new Error(
      'S3-compatible endpoint must be a host name with an optional port',
    );
  }
}

/** DuckDB treats these characters as globs in file and object-store inputs. */
export function assertNoGlobCharacters(path: string): void {
  if (/[*?[\]{}]/.test(path)) {
    throw new Error('Lakehouse paths cannot contain glob metacharacters');
  }
}

export function assertPositiveLimit(limit: number, maximum = 10_000): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) {
    throw new Error(`Limit must be an integer between 1 and ${maximum}`);
  }
}

export function assertDeltaVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new Error('Delta version must be a non-negative safe integer');
  }
}

/** Iceberg snapshot IDs are signed 64-bit values; keep them string-safe at the API edge. */
export function parseIcebergSnapshotId(snapshotId: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(snapshotId)) {
    throw new Error('Iceberg snapshot ID must be an unsigned integer string');
  }
  const parsed = BigInt(snapshotId);
  if (parsed > 9_223_372_036_854_775_807n) {
    throw new Error('Iceberg snapshot ID exceeds DuckDB BIGINT range');
  }
  return parsed;
}
