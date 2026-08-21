import { planStorageSecret } from './lakehouse-secret-plan';

describe('planStorageSecret', () => {
  it('does not create a secret for a local table', () => {
    expect(
      planStorageSecret('request_1', {
        kind: 'local',
        scope: '/srv/lakehouse/table/',
      }),
    ).toBeUndefined();
  });

  it('uses bound values and a path-scoped S3 secret', () => {
    const plan = planStorageSecret('request"1', {
      kind: 's3',
      accessKeyId: 'id',
      secretAccessKey: "secret'not-sql",
      region: 'us-east-1',
      sessionToken: 'token',
      scope: 's3://bucket/prefix/',
    });
    expect(plan!.create.sql).toBe(
      'CREATE SECRET "request""1" (TYPE s3, KEY_ID ?, SECRET ?, REGION ?, SESSION_TOKEN ?, SCOPE ?)',
    );
    expect(plan!.create.values).toEqual([
      'id',
      "secret'not-sql",
      'us-east-1',
      'token',
      's3://bucket/prefix/',
    ]);
    expect(plan!.cleanup.sql).toBe('DROP SECRET IF EXISTS "request""1"');
  });

  it('configures a MinIO-compatible secret with path-style addressing', () => {
    const plan = planStorageSecret('minio', {
      kind: 's3-compatible',
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
      endpoint: 'minio:9000',
      region: 'us-east-1',
      useSsl: false,
      scope: 's3://bucket/warehouse/',
    });
    expect(plan!.create.sql).toContain('TYPE s3');
    expect(plan!.create.sql).toContain("URL_STYLE 'path'");
    expect(plan!.create.values).toEqual([
      'minioadmin',
      'minioadmin',
      'us-east-1',
      'minio:9000',
      false,
      's3://bucket/warehouse/',
    ]);
  });

  it.each([
    {
      kind: 'gcs' as const,
      accessKeyId: 'gcs-id',
      secretAccessKey: 'gcs-secret',
      scope: 'gcs://bucket/table/',
    },
    {
      kind: 'azure' as const,
      connectionString:
        'DefaultEndpointsProtocol=https;AccountName=storageaccount;AccountKey=account-key',
      scope: 'az://container/table/',
    },
  ])('builds a bound $kind secret', (credentials) => {
    const plan = planStorageSecret('remote', credentials);
    expect(plan!.create.sql).toContain('SCOPE ?');
    expect(plan!.create.values).toContain(credentials.scope);
  });

  it('rejects an invalid endpoint and a scope outside its storage scheme', () => {
    expect(() =>
      planStorageSecret('bad', {
        kind: 's3-compatible',
        accessKeyId: 'id',
        secretAccessKey: 'secret',
        endpoint: 'https://minio:9000',
        region: 'us-east-1',
        useSsl: false,
        scope: 's3://bucket/table/',
      }),
    ).toThrow('endpoint');
    expect(() =>
      planStorageSecret('bad', {
        kind: 'azure',
        connectionString:
          'DefaultEndpointsProtocol=https;AccountName=account;AccountKey=key',
        scope: 's3://bucket/table',
      }),
    ).toThrow('azure lakehouse paths');
  });

  it('rejects a raw prefix that is not a table-segment boundary', () => {
    expect(() =>
      planStorageSecret('unsafe-prefix', {
        kind: 's3',
        accessKeyId: 'id',
        secretAccessKey: 'secret',
        region: 'us-east-1',
        scope: 's3://bucket/table',
      }),
    ).toThrow('end with a slash');
  });
});
