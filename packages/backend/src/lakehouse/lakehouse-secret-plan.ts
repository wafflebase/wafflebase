import {
  escapeSqlIdentifier,
  validateLakehousePath,
  validateS3CompatibleEndpoint,
} from './lakehouse-sql';
import {
  LakehouseSecretPlan,
  LakehouseStorageCredentials,
  LakehouseSqlStatement,
} from './lakehouse.types';

function statement(
  sql: string,
  values: LakehouseSqlStatement['values'],
): LakehouseSqlStatement {
  return { sql, values };
}

function requireText(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} cannot be empty`);
}

/**
 * Builds a temporary, path-scoped DuckDB secret. The executor must always run
 * cleanup in finally: DuckDB secrets are instance-scoped rather than request-scoped.
 */
export function planStorageSecret(
  name: string,
  credentials: LakehouseStorageCredentials,
): LakehouseSecretPlan | undefined {
  if (credentials.kind === 'local') return undefined;

  const identifier = escapeSqlIdentifier(name);
  validateLakehousePath(credentials.kind, credentials.scope);
  requireText(credentials.scope, 'Secret scope');
  if (!credentials.scope.endsWith('/')) {
    throw new Error('Secret scope must end with a slash');
  }

  let create: LakehouseSqlStatement;
  switch (credentials.kind) {
    case 's3': {
      requireText(credentials.accessKeyId, 'S3 access key ID');
      requireText(credentials.secretAccessKey, 'S3 secret access key');
      requireText(credentials.region, 'S3 region');
      const token = credentials.sessionToken ? ', SESSION_TOKEN ?' : '';
      const values = credentials.sessionToken
        ? [
            credentials.accessKeyId,
            credentials.secretAccessKey,
            credentials.region,
            credentials.sessionToken,
            credentials.scope,
          ]
        : [
            credentials.accessKeyId,
            credentials.secretAccessKey,
            credentials.region,
            credentials.scope,
          ];
      create = statement(
        `CREATE SECRET ${identifier} (TYPE s3, KEY_ID ?, SECRET ?, REGION ?${token}, SCOPE ?)`,
        values,
      );
      break;
    }
    case 's3-compatible': {
      requireText(credentials.accessKeyId, 'S3-compatible access key ID');
      requireText(
        credentials.secretAccessKey,
        'S3-compatible secret access key',
      );
      requireText(credentials.region, 'S3-compatible region');
      validateS3CompatibleEndpoint(credentials.endpoint);
      const token = credentials.sessionToken ? ', SESSION_TOKEN ?' : '';
      const values = credentials.sessionToken
        ? [
            credentials.accessKeyId,
            credentials.secretAccessKey,
            credentials.region,
            credentials.endpoint,
            credentials.useSsl,
            credentials.sessionToken,
            credentials.scope,
          ]
        : [
            credentials.accessKeyId,
            credentials.secretAccessKey,
            credentials.region,
            credentials.endpoint,
            credentials.useSsl,
            credentials.scope,
          ];
      create = statement(
        `CREATE SECRET ${identifier} (TYPE s3, KEY_ID ?, SECRET ?, REGION ?, ENDPOINT ?, URL_STYLE 'path', USE_SSL ?${token}, SCOPE ?)`,
        values,
      );
      break;
    }
    case 'gcs':
      requireText(credentials.accessKeyId, 'GCS HMAC access key ID');
      requireText(credentials.secretAccessKey, 'GCS HMAC secret access key');
      if (credentials.endpoint) {
        // GCS-interop against a custom endpoint (the schema's "MinIO/R2/
        // GCS-interop" case): same HMAC path, redirected off
        // storage.googleapis.com. Also how CI exercises the gcs kind.
        validateS3CompatibleEndpoint(credentials.endpoint);
        create = statement(
          `CREATE SECRET ${identifier} (TYPE gcs, KEY_ID ?, SECRET ?, ENDPOINT ?, URL_STYLE 'path', USE_SSL ?, SCOPE ?)`,
          [
            credentials.accessKeyId,
            credentials.secretAccessKey,
            credentials.endpoint,
            credentials.useSsl ?? true,
            credentials.scope,
          ],
        );
        break;
      }
      create = statement(
        `CREATE SECRET ${identifier} (TYPE gcs, KEY_ID ?, SECRET ?, SCOPE ?)`,
        [
          credentials.accessKeyId,
          credentials.secretAccessKey,
          credentials.scope,
        ],
      );
      break;
    case 'azure':
      requireText(credentials.connectionString, 'Azure connection string');
      create = statement(
        `CREATE SECRET ${identifier} (TYPE azure, CONNECTION_STRING ?, SCOPE ?)`,
        [credentials.connectionString, credentials.scope],
      );
      break;
  }

  return {
    name,
    scope: credentials.scope,
    create,
    cleanup: statement(`DROP SECRET IF EXISTS ${identifier}`, []),
  };
}
