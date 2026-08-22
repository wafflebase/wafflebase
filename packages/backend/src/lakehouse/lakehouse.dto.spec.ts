import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateLakehouseSourceDto,
  LakehouseHistoryQueryDto,
  ReadLakehouseDto,
  UpdateLakehouseSourceDto,
} from './lakehouse.dto';

async function errorsFor<T extends object>(
  cls: new () => T,
  payload: Record<string, unknown>,
) {
  return validate(plainToInstance(cls, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('CreateLakehouseSourceDto', () => {
  const valid = {
    name: 'warehouse-events',
    format: 'iceberg',
    storage: 's3-compatible',
    endpoint: 'http://localhost:9000',
    region: 'us-east-1',
    bucket: 'lakehouse-fixtures',
    basePath: 'iceberg/events/metadata/current.metadata.json',
    credentials: {
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
    },
  };

  it('accepts a direct-metadata source', async () => {
    expect(await errorsFor(CreateLakehouseSourceDto, valid)).toHaveLength(0);
  });

  it('rejects unsupported formats and storage providers', async () => {
    expect(
      await errorsFor(CreateLakehouseSourceDto, {
        ...valid,
        format: 'hudi',
      }),
    ).not.toHaveLength(0);
    expect(
      await errorsFor(CreateLakehouseSourceDto, {
        ...valid,
        storage: 'ftp',
      }),
    ).not.toHaveLength(0);
  });

  it('rejects whitespace-only names and table paths', async () => {
    expect(
      await errorsFor(CreateLakehouseSourceDto, {
        ...valid,
        name: '   ',
      }),
    ).not.toHaveLength(0);
    expect(
      await errorsFor(CreateLakehouseSourceDto, {
        ...valid,
        basePath: '   ',
      }),
    ).not.toHaveLength(0);
  });

  it('validates nested credentials and rejects unknown fields', async () => {
    expect(
      await errorsFor(CreateLakehouseSourceDto, {
        ...valid,
        credentials: { accessKeyId: 42, admin: true },
      }),
    ).not.toHaveLength(0);
  });

  it.each([
    'accessKeyId',
    'secretAccessKey',
    'sessionToken',
    'accountName',
    'accountKey',
    'connectionString',
    'sasToken',
  ])('rejects null credential field %s', async (field) => {
    expect(
      await errorsFor(CreateLakehouseSourceDto, {
        ...valid,
        credentials: { ...valid.credentials, [field]: null },
      }),
    ).not.toHaveLength(0);
  });
});

describe('UpdateLakehouseSourceDto', () => {
  it('accepts an empty or partial update', async () => {
    expect(await errorsFor(UpdateLakehouseSourceDto, {})).toHaveLength(0);
    expect(
      await errorsFor(UpdateLakehouseSourceDto, { name: 'renamed' }),
    ).toHaveLength(0);
    expect(
      await errorsFor(UpdateLakehouseSourceDto, {
        endpoint: null,
        region: null,
        bucket: null,
      }),
    ).toHaveLength(0);
  });

  it.each(['name', 'format', 'storage', 'basePath', 'credentials'])(
    'rejects null for non-nullable field %s',
    async (field) => {
      expect(
        await errorsFor(UpdateLakehouseSourceDto, { [field]: null }),
      ).not.toHaveLength(0);
    },
  );
});

describe('ReadLakehouseDto', () => {
  it.each([
    { kind: 'version', version: 0 },
    { kind: 'snapshot', snapshotId: '7989807407367529971' },
    { kind: 'timestamp', iso: '2026-07-28T00:00:00Z' },
  ])('accepts a valid commit reference', async (asOf) => {
    expect(await errorsFor(ReadLakehouseDto, { asOf })).toHaveLength(0);
  });

  it.each([
    { kind: 'version', version: -1 },
    { kind: 'version', version: Number.MAX_SAFE_INTEGER + 1 },
    { kind: 'version', version: 1, snapshotId: '2' },
    { kind: 'snapshot', snapshotId: '01' },
    { kind: 'snapshot', snapshotId: '9223372036854775808' },
    { kind: 'snapshot', snapshotId: 'not-numeric' },
    { kind: 'timestamp', iso: 'not-an-instant' },
    { kind: 'timestamp', iso: '2026-07-28T00:00:00Z', version: 1 },
  ])('rejects an invalid or ambiguous commit reference', async (asOf) => {
    expect(await errorsFor(ReadLakehouseDto, { asOf })).not.toHaveLength(0);
  });

  it.each([
    { namespace: ['analytics'], table: 'events' },
    { namespace: ['a', 'b'], table: 'events' },
  ])('accepts a valid catalog table reference', async (table) => {
    expect(await errorsFor(ReadLakehouseDto, { table })).toHaveLength(0);
  });

  it.each([
    { namespace: [], table: 'events' },
    { namespace: ['analytics'], table: '' },
    { namespace: ['analytics'], table: 'ev il' },
    { namespace: ['analytics'] },
    { namespace: ['analytics'], table: 'events', extra: true },
  ])('rejects an invalid catalog table reference', async (table) => {
    expect(await errorsFor(ReadLakehouseDto, { table })).not.toHaveLength(0);
  });

  it('rejects null instead of treating it as latest', async () => {
    expect(await errorsFor(ReadLakehouseDto, { asOf: null })).not.toHaveLength(
      0,
    );
  });
});

describe('LakehouseHistoryQueryDto', () => {
  it('transforms a positive numeric query-string limit', async () => {
    expect(
      await errorsFor(LakehouseHistoryQueryDto, { limit: '25' }),
    ).toHaveLength(0);
  });

  it('rejects zero and non-numeric limits', async () => {
    expect(
      await errorsFor(LakehouseHistoryQueryDto, { limit: '0' }),
    ).not.toHaveLength(0);
    expect(
      await errorsFor(LakehouseHistoryQueryDto, { limit: 'many' }),
    ).not.toHaveLength(0);
  });
});
