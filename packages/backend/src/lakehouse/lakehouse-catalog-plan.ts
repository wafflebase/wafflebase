import { escapeSqlIdentifier, escapeSqlLiteral } from './lakehouse-sql';
import {
  LakehouseCatalogTableRef,
  LakehouseReadPlan,
  LakehouseSqlStatement,
} from './lakehouse.types';

/** The two catalog modes DuckDB's iceberg extension can ATTACH today. */
export type AttachableCatalogMode = 'rest_catalog' | 's3_tables';

export interface LakehouseCatalogAttach {
  /** CREATE SECRET for catalog auth (bearer token); absent for tokenless catalogs. */
  secret?: { create: LakehouseSqlStatement; cleanup: LakehouseSqlStatement };
  attach: LakehouseSqlStatement;
  detach: LakehouseSqlStatement;
}

function statement(
  sql: string,
  values: LakehouseSqlStatement['values'],
): LakehouseSqlStatement {
  return { sql, values };
}

function validateCatalogUri(mode: AttachableCatalogMode, uri: string): void {
  if (mode === 's3_tables') {
    // Amazon S3 Tables addresses the catalog by table-bucket ARN.
    if (!/^arn:aws:s3tables:[a-z0-9-]+:\d{12}:bucket\/[a-z0-9.-]+$/.test(uri)) {
      throw new Error('s3_tables catalogUri must be a table-bucket ARN');
    }
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error('rest_catalog catalogUri must be an HTTP(S) URL');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      'rest_catalog catalogUri must be an HTTP(S) URL without credentials, query, or fragment',
    );
  }
}

function validateWarehouse(warehouse: string): void {
  if (!warehouse.trim()) throw new Error('Catalog warehouse cannot be empty');
  if ([...warehouse].some((c) => c.charCodeAt(0) <= 31)) {
    throw new Error('Catalog warehouse cannot contain control characters');
  }
}

/**
 * ATTACH an Iceberg catalog per the design doc's catalog path ("ATTACH an
 * Iceberg REST catalog / S3 Tables, then SELECT … FROM <ns>.<table>").
 * `alias` must be request-unique: ATTACH aliases are connection-scoped, and
 * secrets are instance-scoped, so the executor must always run detach/cleanup
 * in finally.
 */
export function planCatalogAttach(
  alias: string,
  secretName: string,
  mode: AttachableCatalogMode,
  catalogUri: string,
  warehouse: string,
  catalogToken?: string,
): LakehouseCatalogAttach {
  validateCatalogUri(mode, catalogUri);
  validateWarehouse(warehouse);
  const attachAlias = escapeSqlIdentifier(alias);
  const secretIdentifier = escapeSqlIdentifier(secretName);

  if (mode === 's3_tables') {
    // S3 Tables authenticates with the S3 credentials already minted by the
    // storage-secret plan; the ARN is both the warehouse and the endpoint.
    return {
      attach: statement(
        `ATTACH ${escapeSqlLiteral(catalogUri)} AS ${attachAlias} (TYPE iceberg, ENDPOINT_TYPE s3_tables, READ_ONLY)`,
        [],
      ),
      detach: statement(`DETACH ${attachAlias}`, []),
    };
  }

  const secret = catalogToken
    ? {
        create: statement(
          `CREATE SECRET ${secretIdentifier} (TYPE iceberg, TOKEN ?)`,
          [catalogToken],
        ),
        cleanup: statement(`DROP SECRET IF EXISTS ${secretIdentifier}`, []),
      }
    : undefined;

  return {
    ...(secret && { secret }),
    attach: statement(
      `ATTACH ${escapeSqlLiteral(warehouse)} AS ${attachAlias} (TYPE iceberg, ENDPOINT ${escapeSqlLiteral(catalogUri)}, READ_ONLY)`,
      [],
    ),
    detach: statement(`DETACH ${attachAlias}`, []),
  };
}

/** Lists tables the attached catalog exposes, scoped to the attach alias. */
export function planCatalogTables(alias: string): LakehouseSqlStatement {
  return statement(
    'SELECT schema, name FROM (SHOW ALL TABLES) WHERE database = ? ORDER BY schema, name',
    [alias],
  );
}

/**
 * Reads a catalog table by identifier. Identifiers are escaped (they cannot be
 * bound in this grammar position), and the ref shape is validated at the DTO
 * boundary so no SQL ever originates from the client.
 */
export function planCatalogRead(
  alias: string,
  ref: LakehouseCatalogTableRef,
  limit: number,
): LakehouseReadPlan {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10_001) {
    throw new Error('Limit must be an integer between 1 and 10001');
  }
  // DuckDB qualifies at most `catalog.schema.table`. An attached Iceberg
  // catalog flattens a nested namespace into ONE schema whose name contains
  // dots ("analytics.daily"), which is exactly how `planCatalogTables`
  // reports it back, so the levels are joined before escaping. Escaping each
  // level separately emitted a four-part name and DuckDB answered
  // "Parser Error: NameListToString NOT IMPLEMENTED".
  const qualified = [alias, ref.namespace.join('.'), ref.table]
    .map(escapeSqlIdentifier)
    .join('.');
  return {
    setup: [],
    read: statement(`SELECT * FROM ${qualified} LIMIT ?`, [limit]),
    cleanup: [],
  };
}
