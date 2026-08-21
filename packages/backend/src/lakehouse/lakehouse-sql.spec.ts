import {
  assertDeltaVersion,
  assertPositiveLimit,
  escapeSqlIdentifier,
  escapeSqlLiteral,
  parseIcebergSnapshotId,
  validateLakehousePath,
  validateS3CompatibleEndpoint,
} from './lakehouse-sql';

describe('lakehouse SQL safety helpers', () => {
  it('escapes SQL grammar values that cannot be parameterized', () => {
    expect(escapeSqlLiteral("O'Reilly")).toBe("'O''Reilly'");
    expect(escapeSqlIdentifier('request"alias')).toBe('"request""alias"');
  });

  it('rejects control characters in SQL grammar values', () => {
    expect(() => escapeSqlLiteral('bad\nvalue')).toThrow('control characters');
    expect(() => escapeSqlIdentifier('bad\u0000name')).toThrow(
      'control characters',
    );
  });

  it('accepts only supported local and object-storage paths', () => {
    expect(() =>
      validateLakehousePath('local', '/fixtures/table'),
    ).not.toThrow();
    expect(() =>
      validateLakehousePath('local', 'file:///fixtures/table'),
    ).not.toThrow();
    expect(() =>
      validateLakehousePath('s3', 's3://bucket/warehouse/table'),
    ).not.toThrow();
    expect(() =>
      validateLakehousePath('s3-compatible', 's3://minio-bucket/table'),
    ).not.toThrow();
    expect(() =>
      validateLakehousePath('gcs', 'gcs://bucket/table'),
    ).not.toThrow();
    expect(() =>
      validateLakehousePath('gcs', 'gs://bucket/table'),
    ).not.toThrow();
    expect(() =>
      validateLakehousePath('azure', 'az://container/table'),
    ).not.toThrow();
  });

  it.each([
    ['s3', 'https://bucket/table'],
    ['s3', 's3://key:secret@bucket/table'],
    ['s3', 's3://bucket/table?unsafe=true'],
    ['gcs', 'gcs://bucket/../other'],
    ['local', 'relative/table'],
    ['local', 'file:///fixtures/table?unsafe=true'],
  ] as const)('rejects unsafe or mismatched %s path %s', (storage, path) => {
    expect(() => validateLakehousePath(storage, path)).toThrow();
  });

  it('rejects raw and percent-encoded control characters in paths', () => {
    expect(() =>
      validateLakehousePath('s3', 's3://bucket/table\nname'),
    ).toThrow('control characters');
    expect(() =>
      validateLakehousePath('s3', 's3://bucket/table%00name'),
    ).toThrow('control characters');
  });

  it('rejects object-selection glob metacharacters in every table path', () => {
    expect(() => validateLakehousePath('s3', 's3://bucket/table-*')).toThrow(
      'glob metacharacters',
    );
  });

  it('accepts a host and optional port for a MinIO endpoint only', () => {
    expect(() => validateS3CompatibleEndpoint('minio:9000')).not.toThrow();
    expect(() =>
      validateS3CompatibleEndpoint('storage.example.com'),
    ).not.toThrow();
    expect(() => validateS3CompatibleEndpoint('https://minio:9000')).toThrow();
  });

  it('bounds read limits and preserves 64-bit Iceberg IDs without Number loss', () => {
    expect(() => assertPositiveLimit(10_001)).toThrow('between 1 and 10000');
    expect(() => assertDeltaVersion(-1)).toThrow('non-negative');
    expect(parseIcebergSnapshotId('9007199254740993')).toBe(9007199254740993n);
    expect(() => parseIcebergSnapshotId('1.5')).toThrow('unsigned integer');
  });
});
