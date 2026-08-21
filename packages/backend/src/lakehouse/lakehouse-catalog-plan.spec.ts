import {
  planCatalogAttach,
  planCatalogRead,
  planCatalogTables,
} from './lakehouse-catalog-plan';

describe('planCatalogAttach', () => {
  it('attaches a REST catalog with a token secret', () => {
    const plan = planCatalogAttach(
      'lakehouse_a1',
      'lakehouse_a1_catalog',
      'rest_catalog',
      'https://catalog.example.com/v1',
      'analytics',
      'bearer-token',
    );
    expect(plan.secret?.create.sql).toBe(
      'CREATE SECRET "lakehouse_a1_catalog" (TYPE iceberg, TOKEN ?)',
    );
    expect(plan.secret?.create.values).toEqual(['bearer-token']);
    expect(plan.attach.sql).toBe(
      `ATTACH 'analytics' AS "lakehouse_a1" (TYPE iceberg, ENDPOINT 'https://catalog.example.com/v1', READ_ONLY)`,
    );
    expect(plan.detach.sql).toBe('DETACH "lakehouse_a1"');
  });

  it('attaches a tokenless REST catalog without a secret', () => {
    const plan = planCatalogAttach(
      'lakehouse_a1',
      'lakehouse_a1_catalog',
      'rest_catalog',
      'http://127.0.0.1:8181',
      'default',
    );
    expect(plan.secret).toBeUndefined();
  });

  it('attaches S3 Tables by ARN with the s3_tables endpoint type', () => {
    const plan = planCatalogAttach(
      'lakehouse_a1',
      'lakehouse_a1_catalog',
      's3_tables',
      'arn:aws:s3tables:us-east-1:123456789012:bucket/my-table-bucket',
      'ignored',
    );
    expect(plan.attach.sql).toContain('ENDPOINT_TYPE s3_tables');
    expect(plan.secret).toBeUndefined();
  });

  it.each([
    ['not-a-url', 'rest_catalog'],
    ['https://user:pass@catalog.example.com/v1', 'rest_catalog'],
    ['https://catalog.example.com/v1?token=x', 'rest_catalog'],
    ['arn:aws:s3:us-east-1:123456789012:bucket/b', 's3_tables'],
    ['https://catalog.example.com/v1', 's3_tables'],
  ] as const)('rejects catalogUri %s for %s', (uri, mode) => {
    expect(() => planCatalogAttach('a', 's', mode, uri, 'default')).toThrow();
  });

  it('rejects a warehouse with control characters', () => {
    expect(() =>
      planCatalogAttach(
        'a',
        's',
        'rest_catalog',
        'https://catalog.example.com/v1',
        'ware\nhouse',
      ),
    ).toThrow('control characters');
  });
});

describe('planCatalogTables', () => {
  it('lists tables scoped to the attach alias', () => {
    const plan = planCatalogTables('lakehouse_a1');
    expect(plan.sql).toBe(
      'SELECT schema, name FROM (SHOW ALL TABLES) WHERE database = ? ORDER BY schema, name',
    );
    expect(plan.values).toEqual(['lakehouse_a1']);
  });
});

describe('planCatalogRead', () => {
  it('reads a namespaced table with escaped identifiers and a bound limit', () => {
    const plan = planCatalogRead(
      'lakehouse_a1',
      { namespace: ['analytics', 'daily'], table: 'events' },
      101,
    );
    // DuckDB qualifies at most catalog.schema.table: a nested Iceberg
    // namespace is ONE schema whose name contains dots, which is also how
    // `planCatalogTables` reports it back. Emitting four parts is a parser
    // error ("NameListToString NOT IMPLEMENTED"), not a deeper lookup.
    expect(plan.read.sql).toBe(
      'SELECT * FROM "lakehouse_a1"."analytics.daily"."events" LIMIT ?',
    );
    expect(plan.read.values).toEqual([101]);
    expect(plan.setup).toHaveLength(0);
    expect(plan.cleanup).toHaveLength(0);
  });

  it('escapes a namespace level that itself contains a quote', () => {
    const plan = planCatalogRead(
      'lakehouse_a1',
      { namespace: ['we"ird', 'daily'], table: 'events' },
      1,
    );
    expect(plan.read.sql).toBe(
      'SELECT * FROM "lakehouse_a1"."we""ird.daily"."events" LIMIT ?',
    );
  });

  it('escapes quotes so identifiers cannot break out', () => {
    const plan = planCatalogRead(
      'lakehouse_a1',
      { namespace: ['a"b'], table: 't"t' },
      1,
    );
    expect(plan.read.sql).toContain('"a""b"');
    expect(plan.read.sql).toContain('"t""t"');
  });

  it('rejects an out-of-range limit', () => {
    expect(() =>
      planCatalogRead('a', { namespace: ['n'], table: 't' }, 10_002),
    ).toThrow('Limit');
  });
});
