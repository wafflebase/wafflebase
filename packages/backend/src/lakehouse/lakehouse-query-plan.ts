import {
  assertDeltaVersion,
  assertPositiveLimit,
  escapeSqlIdentifier,
  escapeSqlLiteral,
  parseIcebergSnapshotId,
  validateLakehousePath,
} from './lakehouse-sql';
import {
  LakehouseReadPlan,
  LakehouseSqlStatement,
  LakehouseTableRef,
  LakehouseTimeTravel,
} from './lakehouse.types';

function statement(
  sql: string,
  values: LakehouseSqlStatement['values'],
): LakehouseSqlStatement {
  return { sql, values };
}

function assertTimeTravelMatches(
  ref: LakehouseTableRef,
  asOf: LakehouseTimeTravel | undefined = undefined,
): void {
  if (!asOf) return;
  if (
    (ref.format === 'iceberg' && asOf.kind === 'version') ||
    (ref.format === 'delta' && asOf.kind === 'snapshot')
  ) {
    throw new Error(`Time-travel point does not match ${ref.format} format`);
  }
}

/**
 * Produces only fixed query templates with bound user data. `deltaAlias` must
 * be unique per request because ATTACH aliases live on a DuckDB connection.
 */
export function planLakehouseRead(
  ref: LakehouseTableRef,
  asOf: LakehouseTimeTravel | undefined,
  limit = 10_000,
  deltaAlias?: string,
): LakehouseReadPlan {
  validateLakehousePath(ref.storage, ref.path);
  // One extra row lets the service report truncation at the 10,000-row UI cap.
  assertPositiveLimit(limit, 10_001);
  assertTimeTravelMatches(ref, asOf);

  if (ref.format === 'iceberg') {
    if (asOf?.kind === 'snapshot') {
      return {
        setup: [],
        read: statement(
          'SELECT * FROM iceberg_scan(?, snapshot_from_id = ?) LIMIT ?',
          [ref.path, parseIcebergSnapshotId(asOf.snapshotId), limit],
        ),
        cleanup: [],
      };
    }
    return {
      setup: [],
      read: statement('SELECT * FROM iceberg_scan(?) LIMIT ?', [
        ref.path,
        limit,
      ]),
      cleanup: [],
    };
  }

  if (!asOf) {
    return {
      setup: [],
      read: statement('SELECT * FROM delta_scan(?) LIMIT ?', [ref.path, limit]),
      cleanup: [],
    };
  }

  if (asOf.kind !== 'version') {
    throw new Error('Delta time-travel reads require a Delta version');
  }
  assertDeltaVersion(asOf.version);
  if (!deltaAlias) {
    throw new Error(
      'Delta time-travel reads require a unique attachment alias',
    );
  }
  const alias = escapeSqlIdentifier(deltaAlias);
  return {
    setup: [
      statement(
        `ATTACH ${escapeSqlLiteral(ref.path)} AS ${alias} (TYPE delta, READ_ONLY)`,
        [],
      ),
    ],
    read: statement(`SELECT * FROM ${alias} AT (VERSION => ?) LIMIT ?`, [
      asOf.version,
      limit,
    ]),
    cleanup: [statement(`DETACH ${alias}`, [])],
  };
}

/** Fixed format-specific history queries; adapters map their rows to public history entries. */
export function planLakehouseHistory(
  ref: LakehouseTableRef,
  limit = 1_000,
): LakehouseSqlStatement {
  validateLakehousePath(ref.storage, ref.path);
  assertPositiveLimit(limit, 1_000);
  if (ref.format === 'iceberg') {
    return statement(
      'SELECT snapshot_id, sequence_number, timestamp_ms, manifest_list FROM iceberg_snapshots(?) ORDER BY sequence_number DESC LIMIT ?',
      [ref.path, limit],
    );
  }
  return statement(
    "WITH delta_log AS (SELECT CAST(regexp_extract(filename, '([0-9]{20})\\.json$', 1) AS BIGINT) AS version, TRY_CAST(json_extract(json, '$.commitInfo.timestamp') AS BIGINT) AS timestamp, json_extract_string(json, '$.commitInfo.operation') AS operation FROM read_json_objects(?, format = 'newline_delimited', filename = true)) SELECT version, MAX(timestamp) AS timestamp, MAX(operation) AS operation FROM delta_log GROUP BY version ORDER BY version DESC LIMIT ?",
    [`${ref.path.replace(/\/$/, '')}/_delta_log/*.json`, limit],
  );
}
