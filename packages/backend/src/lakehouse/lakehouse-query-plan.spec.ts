import {
  planLakehouseHistory,
  planLakehouseRead,
} from './lakehouse-query-plan';
import { LakehouseTableRef } from './lakehouse.types';

const iceberg: LakehouseTableRef = {
  format: 'iceberg',
  storage: 's3',
  path: 's3://bucket/warehouse/events/metadata/v1.metadata.json',
};
const delta: LakehouseTableRef = {
  format: 'delta',
  storage: 's3-compatible',
  path: 's3://bucket/delta-events',
};

describe('planLakehouseRead', () => {
  it('uses a fixed, bound Iceberg latest query', () => {
    expect(planLakehouseRead(iceberg, undefined, 50)).toEqual({
      setup: [],
      read: {
        sql: 'SELECT * FROM iceberg_scan(?) LIMIT ?',
        values: [iceberg.path, 50],
      },
      cleanup: [],
    });
  });

  it('allows the one extra row used to detect a truncated 10,000-row result', () => {
    expect(planLakehouseRead(iceberg, undefined, 10_001).read.values).toEqual([
      iceberg.path,
      10_001,
    ]);
  });

  it('binds an Iceberg snapshot ID as bigint', () => {
    const plan = planLakehouseRead(iceberg, {
      kind: 'snapshot',
      snapshotId: '9007199254740993',
    });
    expect(plan.read.sql).toBe(
      'SELECT * FROM iceberg_scan(?, snapshot_from_id = ?) LIMIT ?',
    );
    expect(plan.read.values).toEqual([iceberg.path, 9007199254740993n, 10_000]);
  });

  it('uses delta_scan for latest and attach/select/detach for historical reads', () => {
    expect(planLakehouseRead(delta, undefined).read).toEqual({
      sql: 'SELECT * FROM delta_scan(?) LIMIT ?',
      values: [delta.path, 10_000],
    });
    const historic = planLakehouseRead(
      delta,
      { kind: 'version', version: 3 },
      100,
      'request"3',
    );
    expect(historic.setup).toEqual([
      {
        sql: 'ATTACH \'s3://bucket/delta-events\' AS "request""3" (TYPE delta, READ_ONLY)',
        values: [],
      },
    ]);
    expect(historic.read).toEqual({
      sql: 'SELECT * FROM "request""3" AT (VERSION => ?) LIMIT ?',
      values: [3, 100],
    });
    expect(historic.cleanup).toEqual([
      { sql: 'DETACH "request""3"', values: [] },
    ]);
  });

  it('rejects mismatched time-travel formats and missing Delta aliases', () => {
    expect(() =>
      planLakehouseRead(iceberg, { kind: 'version', version: 1 }),
    ).toThrow('does not match');
    expect(() =>
      planLakehouseRead(delta, { kind: 'version', version: 1 }),
    ).toThrow('unique attachment alias');
  });

  it('escapes the unbindable Delta ATTACH path without accepting SQL', () => {
    const quotedPath: LakehouseTableRef = {
      ...delta,
      path: "s3://bucket/delta'events",
    };
    const plan = planLakehouseRead(
      quotedPath,
      { kind: 'version', version: 0 },
      10,
      'request_4',
    );
    expect(plan.setup[0]).toEqual({
      sql: "ATTACH 's3://bucket/delta''events' AS \"request_4\" (TYPE delta, READ_ONLY)",
      values: [],
    });
    expect(plan.setup[0].sql).not.toContain("delta'events' AS");
  });
});

describe('planLakehouseHistory', () => {
  it('uses native Iceberg snapshot metadata', () => {
    expect(planLakehouseHistory(iceberg)).toEqual({
      sql: 'SELECT snapshot_id, sequence_number, timestamp_ms, manifest_list FROM iceberg_snapshots(?) ORDER BY sequence_number DESC LIMIT ?',
      values: [iceberg.path, 1_000],
    });
  });

  it('retains every Delta version even when a log lacks commitInfo', () => {
    const plan = planLakehouseHistory(delta);
    expect(plan.sql).toContain(
      "read_json_objects(?, format = 'newline_delimited', filename = true)",
    );
    expect(plan.sql).toContain("json_extract(json, '$.commitInfo.timestamp')");
    expect(plan.sql).toContain('GROUP BY version');
    expect(plan.sql).not.toContain('commitInfo IS NOT NULL');
    expect(plan.sql).toContain('ORDER BY version DESC LIMIT ?');
    expect(plan.values).toEqual([
      's3://bucket/delta-events/_delta_log/*.json',
      1_000,
    ]);
  });

  it('rejects user-supplied glob metacharacters before building Delta history', () => {
    expect(() =>
      planLakehouseHistory({
        ...delta,
        path: 's3://bucket/*/events',
      }),
    ).toThrow('glob metacharacters');
  });

  it('rejects glob metacharacters for latest reads too', () => {
    expect(() =>
      planLakehouseRead(
        {
          ...delta,
          path: 's3://bucket/*/events',
        },
        undefined,
      ),
    ).toThrow('glob metacharacters');
  });
});
