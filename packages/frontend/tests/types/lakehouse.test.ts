import { describe, expect, it } from 'vitest';
import {
  getLakehouseCredentialsError,
  getLakehouseEndpointError,
  getLakehouseSourcePathError,
  isLakehouseHistoryRef,
} from '@/types/lakehouse';

describe('isLakehouseHistoryRef', () => {
  it.each([
    { kind: 'version', version: 0 },
    { kind: 'version', version: Number.MAX_SAFE_INTEGER },
    { kind: 'snapshot', snapshotId: '0' },
    { kind: 'snapshot', snapshotId: '9223372036854775807' },
  ])('accepts a valid runtime ref: $kind', (value) => {
    expect(isLakehouseHistoryRef(value)).toBe(true);
  });

  it.each([
    undefined,
    null,
    [],
    { kind: 'version' },
    { kind: 'version', version: -1 },
    { kind: 'version', version: 1.5 },
    { kind: 'version', version: Number.MAX_SAFE_INTEGER + 1 },
    { kind: 'version', version: 1, extra: true },
    { kind: 'snapshot', snapshotId: '01' },
    { kind: 'snapshot', snapshotId: '-1' },
    { kind: 'snapshot', snapshotId: '9223372036854775808' },
    { kind: 'snapshot', snapshotId: '1', extra: true },
  ])('rejects an invalid runtime ref', (value) => {
    expect(isLakehouseHistoryRef(value)).toBe(false);
  });
});

describe('getLakehouseSourcePathError', () => {
  it('requires direct Iceberg sources to point to a metadata file', () => {
    expect(
      getLakehouseSourcePathError({
        format: 'iceberg',
        storage: 's3-compatible',
        bucket: 'fixtures',
        basePath: 'warehouse/orders',
      }),
    ).toMatch(/\.metadata\.json/);
    expect(
      getLakehouseSourcePathError({
        format: 'iceberg',
        storage: 's3-compatible',
        bucket: 'fixtures',
        basePath: 'warehouse/orders/metadata/v3.metadata.json',
      }),
    ).toBeUndefined();
  });

  it('requires a bucket with a relative object path', () => {
    expect(
      getLakehouseSourcePathError({
        format: 'delta',
        storage: 's3',
        basePath: 'warehouse/orders',
      }),
    ).toMatch(/bucket/);
    expect(
      getLakehouseSourcePathError({
        format: 'delta',
        storage: 's3',
        bucket: 'warehouse',
        basePath: 's3://warehouse/orders',
      }),
    ).toMatch(/relative/);
    expect(
      getLakehouseSourcePathError({
        format: 'delta',
        storage: 's3',
        basePath: 's3://warehouse/orders',
      }),
    ).toBeUndefined();
  });

  it.each([
    ['s3', 's3://warehouse/orders', false],
    ['s3-compatible', 's3://warehouse/orders', false],
    ['gcs', 'gs://warehouse/orders', false],
    ['azure', 'az://warehouse/orders', false],
    ['gcs', 's3://warehouse/orders', true],
    ['azure', 'azure://warehouse/orders', true],
  ] as const)('validates the %s URI scheme', (storage, basePath, hasError) => {
    const error = getLakehouseSourcePathError({
      format: 'delta',
      storage,
      basePath,
    });
    expect(Boolean(error)).toBe(hasError);
  });

  it('accepts a Delta table root but rejects _delta_log', () => {
    expect(
      getLakehouseSourcePathError({
        format: 'delta',
        storage: 'local',
        basePath: '/warehouse/orders',
      }),
    ).toBeUndefined();
    expect(
      getLakehouseSourcePathError({
        format: 'delta',
        storage: 'local',
        basePath: '/warehouse/orders/_delta_log',
      }),
    ).toMatch(/table root/);
  });

  it('requires local paths to be absolute server paths', () => {
    expect(
      getLakehouseSourcePathError({
        format: 'delta',
        storage: 'local',
        basePath: 'relative/orders',
      }),
    ).toMatch(/absolute/);
    expect(
      getLakehouseSourcePathError({
        format: 'delta',
        storage: 'local',
        basePath: 'file:///srv/orders',
      }),
    ).toBeUndefined();
  });

  it.each([
    's3://',
    's3://key:secret@warehouse/orders',
    's3://warehouse:9000/orders',
    's3://warehouse/orders?unsafe=true',
    's3://warehouse/orders#fragment',
    's3://warehouse/../other',
    's3://warehouse/order-*',
  ])('rejects an unsafe fully-qualified object path: %s', (basePath) => {
    expect(
      getLakehouseSourcePathError({
        format: 'delta',
        storage: 's3',
        basePath,
      }),
    ).toBeDefined();
  });

  it.each(['../orders', 'orders?unsafe=true', 'order-*'])(
    'rejects an unsafe bucket-relative object path: %s',
    (basePath) => {
      expect(
        getLakehouseSourcePathError({
          format: 'delta',
          storage: 's3',
          bucket: 'warehouse',
          basePath,
        }),
      ).toBeDefined();
    },
  );
});

describe('getLakehouseEndpointError', () => {
  it('requires a path-free HTTP(S) origin for S3-compatible storage', () => {
    expect(getLakehouseEndpointError('s3-compatible', '')).toMatch(/requires/);
    expect(
      getLakehouseEndpointError('s3-compatible', 'localhost:9000'),
    ).toMatch(/HTTP/i);
    expect(
      getLakehouseEndpointError(
        's3-compatible',
        'http://localhost:9000/prefix',
      ),
    ).toMatch(/path/);
    expect(
      getLakehouseEndpointError('s3-compatible', 'http://localhost:9000'),
    ).toBeUndefined();
  });

  it('allows an optional Azure emulator path but rejects connection-string separators', () => {
    expect(getLakehouseEndpointError('azure', '')).toBeUndefined();
    expect(
      getLakehouseEndpointError(
        'azure',
        'http://localhost:10000/devstoreaccount1',
      ),
    ).toBeUndefined();
    expect(
      getLakehouseEndpointError('azure', 'https://blob.example;AccountKey=x'),
    ).toMatch(/semicolons/);
  });
});

describe('getLakehouseCredentialsError', () => {
  it('requires complete S3 credentials for a new source', () => {
    expect(
      getLakehouseCredentialsError(
        's3-compatible',
        { accessKeyId: 'key' },
        false,
      ),
    ).toMatch(/secret key/);
    expect(
      getLakehouseCredentialsError(
        's3-compatible',
        { accessKeyId: 'key', secretAccessKey: 'secret' },
        false,
      ),
    ).toBeUndefined();
  });

  it('allows omission but requires atomic key-pair rotation when credentials can merge', () => {
    expect(getLakehouseCredentialsError('s3', {}, true)).toBeUndefined();
    expect(
      getLakehouseCredentialsError(
        's3',
        { secretAccessKey: 'replacement' },
        true,
      ),
    ).toMatch(/rotated together/);
    expect(
      getLakehouseCredentialsError(
        's3',
        { accessKeyId: 'replacement', secretAccessKey: 'replacement-secret' },
        true,
      ),
    ).toBeUndefined();
  });

  it('accepts Azure account-key or SAS auth and rejects both together', () => {
    expect(
      getLakehouseCredentialsError(
        'azure',
        { accountName: 'account', sasToken: 'sv=1&sig=secret' },
        false,
      ),
    ).toBeUndefined();
    expect(
      getLakehouseCredentialsError(
        'azure',
        {
          accountName: 'account',
          accountKey: 'key',
          sasToken: 'sv=1&sig=secret',
        },
        false,
      ),
    ).toMatch(/not both/);
  });

  it('keeps Azure connection-string and account credential modes exclusive', () => {
    expect(
      getLakehouseCredentialsError(
        'azure',
        { connectionString: 'UseDevelopmentStorage=true' },
        false,
      ),
    ).toBeUndefined();
    expect(
      getLakehouseCredentialsError(
        'azure',
        {
          connectionString: 'UseDevelopmentStorage=true',
          accountName: 'account',
          accountKey: 'key',
        },
        false,
      ),
    ).toMatch(/by itself/);
    expect(
      getLakehouseCredentialsError(
        'azure',
        {
          connectionString: 'UseDevelopmentStorage=true',
          sasToken: 'sv=1&sig=secret',
        },
        true,
      ),
    ).toMatch(/by itself/);
    expect(
      getLakehouseCredentialsError(
        'azure',
        {
          accountKey: 'key',
          sasToken: 'sv=1&sig=secret',
        },
        true,
      ),
    ).toMatch(/not both/);
  });
});
