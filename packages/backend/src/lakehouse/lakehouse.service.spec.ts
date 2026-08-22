import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  RequestTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DuckDBConnection } from '@duckdb/node-api';
import { LakehouseSource, Prisma } from '@prisma/client';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { PrismaService } from 'src/database/prisma.service';
import { decrypt, encrypt } from 'src/datasource/crypto.util';
import {
  DuckDbQueryTimeoutError,
  DuckDbService,
  DuckDbUnavailableError,
} from './duckdb.service';
import { LakehouseService } from './lakehouse.service';
import {
  LakehouseQueryResponse,
  LakehouseSecretPlan,
  LakehouseSqlStatement,
} from './lakehouse.types';

const TEST_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const storedCredentials = {
  accessKeyId: 'minioadmin',
  secretAccessKey: 'minio-secret',
};

function source(overrides: Partial<LakehouseSource> = {}): LakehouseSource {
  return {
    id: 'source-1',
    name: 'events',
    format: 'delta',
    storage: 's3-compatible',
    endpoint: 'http://127.0.0.1:9000',
    region: 'us-east-1',
    bucket: 'lakehouse-fixtures',
    basePath: 'delta-events',
    catalogMode: 'direct_metadata' as const,
    catalogUri: null,
    credentials: encrypt(JSON.stringify(storedCredentials)),
    authorID: 7,
    workspaceId: 'workspace-1',
    createdAt: new Date('2026-07-28T00:00:00Z'),
    updatedAt: new Date('2026-07-28T00:00:00Z'),
    ...overrides,
  };
}

type CreateSourceArgs = {
  data: { credentials: string } & Record<string, unknown>;
};

type UpdateSourceArgs = {
  where?: Record<string, unknown>;
  data: { credentials?: string } & Record<string, unknown>;
};

class MockPrisma {
  createResult = source({ id: 'created-1' });
  createError: Error | undefined;
  findManyResult: LakehouseSource[] = [];
  findUniqueResult: LakehouseSource | null = source();
  deleteResult = source();
  createCalls = 0;
  createdCredentials: string | undefined;
  updatedCredentials: string | undefined;
  updatedData: UpdateSourceArgs['data'] | undefined;
  updatedWhere: UpdateSourceArgs['where'] | undefined;
  updateManyCount = 1;

  lakehouseSource = {
    create: (args: CreateSourceArgs): Promise<LakehouseSource> => {
      this.createCalls += 1;
      this.createdCredentials = args.data.credentials;
      if (this.createError) return Promise.reject(this.createError);
      return Promise.resolve(this.createResult);
    },
    findMany: (): Promise<LakehouseSource[]> =>
      Promise.resolve(this.findManyResult),
    findUnique: (): Promise<LakehouseSource | null> =>
      Promise.resolve(this.findUniqueResult),
    updateMany: (args: UpdateSourceArgs): Promise<{ count: number }> => {
      this.updatedData = args.data;
      this.updatedWhere = args.where;
      this.updatedCredentials = args.data.credentials;
      return Promise.resolve({ count: this.updateManyCount });
    },
    delete: (): Promise<LakehouseSource> => Promise.resolve(this.deleteResult),
  };
}

class MockDuckDb {
  readonly connection = {
    id: 'connection-1',
  } as unknown as DuckDBConnection;
  readonly statements: LakehouseSqlStatement[] = [];
  withConnectionCalls = 0;
  queryStatement: LakehouseSqlStatement | undefined;
  queryError: Error | undefined;
  runError:
    | ((statement: LakehouseSqlStatement) => Error | undefined)
    | undefined;
  invalidateCalls = 0;
  queryHandler: (() => Promise<LakehouseQueryResponse>) | undefined;
  queryRowsResult: Array<Record<string, unknown>> = [];
  queryResponse: LakehouseQueryResponse = {
    columns: [{ name: 'id', dataTypeID: 4 }],
    rows: [{ id: 1 }],
    rowCount: 1,
    truncated: false,
    executionTime: 2,
  };

  withConnection<T>(
    operation: (value: DuckDBConnection) => Promise<T>,
  ): Promise<T> {
    this.withConnectionCalls += 1;
    return operation(this.connection);
  }

  withStorageSecret<T>(
    secret: LakehouseSecretPlan | undefined,
    operation: (value: DuckDBConnection) => Promise<T>,
  ): Promise<T> {
    return this.withConnection(async (connection) => {
      if (secret) await this.run(connection, secret.create);
      let result: T | undefined;
      let operationError: Error | undefined;
      try {
        result = await operation(connection);
      } catch (error) {
        operationError =
          error instanceof Error ? error : new Error('Mock operation failed');
      }
      if (secret) await this.run(connection, secret.cleanup);
      if (operationError) throw operationError;
      return result as T;
    });
  }

  run(
    _connection: DuckDBConnection,
    statement: LakehouseSqlStatement,
  ): Promise<void> {
    this.statements.push(statement);
    const error = this.runError?.(statement);
    if (error) return Promise.reject(error);
    return Promise.resolve();
  }

  invalidate(): void {
    this.invalidateCalls += 1;
  }

  query(
    _connection: DuckDBConnection,
    statement: LakehouseSqlStatement,
    _maxRows: number,
  ): Promise<LakehouseQueryResponse> {
    void _maxRows;
    this.queryStatement = statement;
    if (this.queryHandler) return this.queryHandler();
    return this.queryError
      ? Promise.reject(this.queryError)
      : Promise.resolve(this.queryResponse);
  }

  queryRows(): Promise<Array<Record<string, unknown>>> {
    return Promise.resolve(this.queryRowsResult);
  }
}

async function rejectedError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error('Expected the promise to reject with an Error');
  }
  throw new Error('Expected the promise to reject');
}

describe('LakehouseService', () => {
  let prisma: MockPrisma;
  let duckDb: MockDuckDb;
  let service: LakehouseService;

  beforeEach(() => {
    process.env.DATASOURCE_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
    process.env.LAKEHOUSE_ALLOWED_ENDPOINTS = [
      'http://127.0.0.1:9000',
      'http://127.0.0.1:10000/devstoreaccount1',
    ].join(',');
    delete process.env.LAKEHOUSE_ALLOW_LOCAL_PATHS;
    delete process.env.LAKEHOUSE_LOCAL_ROOT;
    prisma = new MockPrisma();
    duckDb = new MockDuckDb();
    service = new LakehouseService(
      prisma as unknown as PrismaService,
      duckDb as unknown as DuckDbService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('encrypts credentials and masks them in the create response', async () => {
    const result = await service.create(7, 'workspace-1', {
      name: 'events',
      format: 'delta',
      storage: 's3-compatible',
      endpoint: 'http://127.0.0.1:9000',
      region: 'us-east-1',
      bucket: 'lakehouse-fixtures',
      basePath: 'delta-events',
      credentials: storedCredentials,
    });

    if (!prisma.createdCredentials) {
      throw new Error('Expected encrypted credentials in create call');
    }
    const written = prisma.createdCredentials;
    expect(written).not.toContain('minio-secret');
    expect(JSON.parse(decrypt(written))).toEqual(storedCredentials);
    expect(result.credentials).toBe('********');
  });

  it('masks credentials in workspace listings', async () => {
    prisma.findManyResult = [source()];

    await expect(service.findAllByWorkspace('workspace-1')).resolves.toEqual([
      expect.objectContaining({ id: 'source-1', credentials: '********' }),
    ]);
  });

  it.each([
    { label: 'findOne', act: () => service.findOne('source-1') },
    {
      label: 'update',
      act: () => service.update('source-1', { name: 'renamed' }),
    },
    { label: 'remove', act: () => service.remove('source-1') },
  ])(
    '$label never returns the stored ciphertext to the caller',
    async ({ act }) => {
      // Each of these returns a row that carries the encrypted blob; the
      // masking is the only thing between a workspace member and another
      // member's credentials. Returning the raw row from any one of them is
      // a one-line regression, so pin all three.
      const result = (await act()) as { credentials?: string | null };

      expect(result.credentials).toBe('********');
      expect(result.credentials).not.toContain('minio-secret');
      expect(result.credentials).not.toContain(':');
    },
  );

  it('rotates an access-key pair together before encrypting the update', async () => {
    await service.update('source-1', {
      credentials: {
        accessKeyId: 'rotated-id',
        secretAccessKey: 'rotated-secret',
      },
    });

    if (!prisma.updatedCredentials) {
      throw new Error('Expected encrypted credentials in update call');
    }
    expect(JSON.parse(decrypt(prisma.updatedCredentials))).toEqual({
      accessKeyId: 'rotated-id',
      secretAccessKey: 'rotated-secret',
    });
  });

  it('treats an empty credential patch as a no-op', async () => {
    await service.update('source-1', {
      name: 'renamed-events',
      credentials: {},
    });

    expect(prisma.updatedData).toMatchObject({ name: 'renamed-events' });
    expect(prisma.updatedCredentials).toBeUndefined();
  });

  it('rejects a stale credential merge when the persisted target changed concurrently', async () => {
    prisma.updateManyCount = 0;
    const persisted = prisma.findUniqueResult;

    await expect(
      service.update('source-1', {
        credentials: {
          accessKeyId: 'rotated-id',
          secretAccessKey: 'rotated-secret',
        },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.updatedWhere).toMatchObject({
      id: 'source-1',
      format: persisted?.format,
      storage: persisted?.storage,
      endpoint: persisted?.endpoint,
      region: persisted?.region,
      bucket: persisted?.bucket,
      basePath: 'delta-events',
      credentials: persisted?.credentials,
      updatedAt: persisted?.updatedAt,
    });
  });

  it('rejects rotating only one half of an access-key pair', async () => {
    await expect(
      service.update('source-1', {
        credentials: { secretAccessKey: 'rotated-secret' },
      }),
    ).rejects.toThrow('must be rotated together');
    expect(prisma.updatedData).toBeUndefined();
  });

  it('clears an omitted session token when rotating the key pair', async () => {
    prisma.findUniqueResult = source({
      credentials: encrypt(
        JSON.stringify({ ...storedCredentials, sessionToken: 'old-token' }),
      ),
    });

    await service.update('source-1', {
      credentials: {
        accessKeyId: 'rotated-id',
        secretAccessKey: 'rotated-secret',
      },
    });

    expect(JSON.parse(decrypt(prisma.updatedCredentials!))).toEqual({
      accessKeyId: 'rotated-id',
      secretAccessKey: 'rotated-secret',
    });
  });

  it('does not reuse credentials when the storage provider changes', async () => {
    await expect(
      service.update('source-1', {
        storage: 'gcs',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.updatedData).toBeUndefined();
  });

  it('normalizes irrelevant fields and fresh credentials on storage change', async () => {
    await service.update('source-1', {
      storage: 'gcs',
      credentials: {
        accessKeyId: 'gcs-id',
        secretAccessKey: 'gcs-secret',
      },
    });

    // gcs keeps the custom endpoint (the schema's GCS-interop case) but
    // drops the S3-only region field.
    expect(prisma.updatedData).toMatchObject({
      storage: 'gcs',
      endpoint: 'http://127.0.0.1:9000',
      region: null,
      bucket: 'lakehouse-fixtures',
    });
    expect(JSON.parse(decrypt(prisma.updatedCredentials!))).toEqual({
      accessKeyId: 'gcs-id',
      secretAccessKey: 'gcs-secret',
    });
  });

  it('drops the endpoint when switching to plain s3', async () => {
    await service.update('source-1', {
      storage: 's3',
      region: 'us-east-1',
      credentials: {
        accessKeyId: 's3-id',
        secretAccessKey: 's3-secret',
      },
    });

    expect(prisma.updatedData).toMatchObject({
      storage: 's3',
      endpoint: null,
      region: 'us-east-1',
    });
  });

  it('removes stored credentials when switching to local storage', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wafflebase-lakehouse-root-'));
    const localTable = join(root, 'events');
    mkdirSync(localTable);
    process.env.LAKEHOUSE_ALLOW_LOCAL_PATHS = 'true';
    process.env.LAKEHOUSE_LOCAL_ROOT = root;

    try {
      await service.update('source-1', {
        storage: 'local',
        endpoint: null,
        region: null,
        bucket: null,
        basePath: localTable,
      });

      if (!prisma.updatedCredentials) {
        throw new Error('Expected credentials to be cleared in update call');
      }
      expect(JSON.parse(decrypt(prisma.updatedCredentials))).toEqual({});
      expect(prisma.updatedData).toMatchObject({
        storage: 'local',
        endpoint: null,
        region: null,
        bucket: null,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes null when an optional connection field is explicitly cleared', async () => {
    prisma.findUniqueResult = source({ storage: 's3' });

    await service.update('source-1', { endpoint: null });
    expect(prisma.updatedData).toMatchObject({ endpoint: null });
  });

  it('requires fresh credentials when transiently testing another target', async () => {
    await expect(
      service.testConnection('source-1', { basePath: 'other-table' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.testConnection('source-1', {
        basePath: 'other-table',
        credentials: storedCredentials,
      }),
    ).resolves.toEqual({ success: true });
    expect(prisma.updatedData).toBeUndefined();
  });

  it('does not reuse credentials when an extra trailing slash retargets a table', async () => {
    prisma.findUniqueResult = source({ basePath: 'delta-events/' });

    await expect(
      service.update('source-1', { basePath: 'delta-events//' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.updatedData).toBeUndefined();
  });

  it('returns not found for an unknown source', async () => {
    prisma.findUniqueResult = null;

    await expect(service.findRaw('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('runs historical Delta reads with attach/detach and secret cleanup', async () => {
    prisma.findUniqueResult = source();

    const result = await service.read('source-1', {
      asOf: { kind: 'version', version: 0 },
    });

    expect(result.rows).toEqual([{ id: 1 }]);
    const runSql = duckDb.statements.map((statement) => statement.sql);
    expect(runSql[0]).toContain('CREATE SECRET');
    expect(runSql[1]).toMatch(
      /^ATTACH 's3:\/\/lakehouse-fixtures\/delta-events' AS /,
    );
    expect(runSql[2]).toMatch(/^DETACH /);
    expect(runSql[3]).toContain('DROP SECRET IF EXISTS');
    expect(duckDb.queryStatement?.sql).toContain('AT (VERSION => ?) LIMIT ?');
    expect(duckDb.queryStatement?.values).toEqual([0, 10_001]);
    expect(runSql.join(' ')).not.toContain('minio-secret');
    expect(duckDb.statements[0].values.at(-1)).toBe(
      's3://lakehouse-fixtures/delta-events/',
    );
  });

  it('detaches and removes the secret when a Delta read fails', async () => {
    prisma.findUniqueResult = source();
    duckDb.queryError = new Error('remote read failed');

    const error = await rejectedError(
      service.read('source-1', {
        asOf: { kind: 'version', version: 1 },
      }),
    );
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toBe('Lakehouse query failed');

    const runSql = duckDb.statements.map((statement) => statement.sql);
    expect(runSql.at(-2)).toMatch(/^DETACH /);
    expect(runSql.at(-1)).toContain('DROP SECRET IF EXISTS');
  });

  it('rejects a commit reference for the wrong table format before querying', async () => {
    prisma.findUniqueResult = source();

    await expect(
      service.read('source-1', {
        asOf: { kind: 'snapshot', snapshotId: '123' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(duckDb.withConnectionCalls).toBe(0);
  });

  it('maps Iceberg snapshot history to the public slider contract', async () => {
    prisma.findUniqueResult = source({
      format: 'iceberg',
      basePath: 'iceberg/events/metadata/00003.metadata.json',
    });
    duckDb.queryRowsResult = [
      {
        snapshot_id: '7989807407367529971',
        sequence_number: '1',
        timestamp_ms: '2026-07-27 17:21:45.824',
      },
    ];

    await expect(service.history('source-1')).resolves.toEqual([
      {
        ref: {
          kind: 'snapshot',
          snapshotId: '7989807407367529971',
        },
        timestamp: '2026-07-27T17:21:45.824Z',
      },
    ]);
    expect(duckDb.statements[0].values.at(-1)).toBe(
      's3://lakehouse-fixtures/iceberg/events/',
    );
  });

  it('keeps local paths disabled unless a server root is explicitly configured', async () => {
    await expect(
      service.create(7, 'workspace-1', {
        name: 'local-events',
        format: 'delta',
        storage: 'local',
        basePath: '/tmp/lakehouse/events',
        credentials: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.create(7, 'workspace-1', {
        name: 'local-secret',
        format: 'delta',
        storage: 'local',
        basePath: '/not-used',
        credentials: { secretAccessKey: 'must-not-be-stored' },
      }),
    ).rejects.toThrow('local does not accept credential field');
    expect(prisma.createCalls).toBe(0);
  });

  it('reports pure planner validation failures as bad requests', async () => {
    await expect(
      service.create(7, 'workspace-1', {
        name: 'invalid-secret',
        format: 'delta',
        storage: 's3',
        region: 'us-east-1',
        bucket: 'fixtures',
        basePath: 'delta-events',
        credentials: {
          accessKeyId: 'access-key',
          secretAccessKey: '   ',
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.createCalls).toBe(0);
  });

  it('resolves local symlinks before enforcing the configured root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wafflebase-lakehouse-root-'));
    const outside = mkdtempSync(
      join(tmpdir(), 'wafflebase-lakehouse-outside-'),
    );
    const outsideTable = join(outside, 'events');
    mkdirSync(outsideTable);
    symlinkSync(outside, join(root, 'escape'));
    process.env.LAKEHOUSE_ALLOW_LOCAL_PATHS = 'true';
    process.env.LAKEHOUSE_LOCAL_ROOT = root;

    try {
      await expect(
        service.create(7, 'workspace-1', {
          name: 'escaped-events',
          format: 'delta',
          storage: 'local',
          basePath: join(root, 'escape', 'events'),
          credentials: {},
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.createCalls).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('rejects relative local paths even when they resolve inside the allowed root', async () => {
    const root = mkdtempSync(join(process.cwd(), 'lakehouse-local-root-'));
    const localTable = join(root, 'events');
    mkdirSync(localTable);
    process.env.LAKEHOUSE_ALLOW_LOCAL_PATHS = 'true';
    process.env.LAKEHOUSE_LOCAL_ROOT = root;

    try {
      await expect(
        service.create(7, 'workspace-1', {
          name: 'relative-events',
          format: 'delta',
          storage: 'local',
          basePath: relative(process.cwd(), localTable),
          credentials: {},
        }),
      ).rejects.toThrow('must be absolute');
      expect(prisma.createCalls).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('redacts credentials if DuckDB includes one in an error', async () => {
    prisma.findUniqueResult = source();
    duckDb.queryError = new Error(
      'remote rejected minio-secret while opening table',
    );

    const error = await rejectedError(service.read('source-1', {}));
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toBe('Lakehouse query failed');
  });

  it('redacts an Azure SAS token after normalizing its leading question mark', async () => {
    const sasToken = '?sv=2026-01-01&sig=secret';
    prisma.findUniqueResult = source({
      storage: 'azure',
      endpoint: 'http://127.0.0.1:10000/devstoreaccount1',
      bucket: 'fixtures',
      basePath: 'delta-events',
      credentials: encrypt(
        JSON.stringify({
          accountName: 'devstoreaccount1',
          sasToken,
        }),
      ),
    });
    duckDb.queryError = new Error(
      `remote rejected ${sasToken.slice(1)} while opening table`,
    );

    const error = await rejectedError(service.read('source-1', {}));
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toBe('Lakehouse query failed');
  });

  it('derives a bound Azure SAS connection string for a custom endpoint', async () => {
    prisma.findUniqueResult = source({
      storage: 'azure',
      endpoint: 'http://127.0.0.1:10000/devstoreaccount1',
      bucket: 'fixtures',
      basePath: 'delta-events',
      credentials: encrypt(
        JSON.stringify({
          accountName: 'devstoreaccount1',
          sasToken: '?sv=2026-01-01&sig=secret',
        }),
      ),
    });

    await service.read('source-1', {});

    expect(duckDb.statements[0].sql).toContain(
      'TYPE azure, CONNECTION_STRING ?, SCOPE ?',
    );
    expect(duckDb.statements[0].values).toEqual([
      'BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;AccountName=devstoreaccount1;SharedAccessSignature=sv=2026-01-01&sig=secret',
      'az://fixtures/delta-events/',
    ]);
    expect(duckDb.statements[0].sql).not.toContain('sig=secret');
  });

  it('scopes the secret with the path DuckDB actually scans, not a percent-encoded one', async () => {
    // The scope is a plain prefix match against the URI handed to
    // delta_scan/iceberg_scan. Building it through `new URL(...).pathname`
    // percent-encodes spaces and non-ASCII, so the prefix would never match
    // the raw path and the read would run WITHOUT the credential.
    prisma.findUniqueResult = source({
      storage: 's3',
      region: 'us-east-1',
      bucket: 'analytics',
      basePath: 'my table/데이터',
      credentials: encrypt(
        JSON.stringify({
          accessKeyId: 'key',
          secretAccessKey: 'secret',
        }),
      ),
    });

    await service.read('source-1', {});

    const secretStatement = duckDb.statements.find((statement) =>
      statement.sql.includes('SCOPE ?'),
    );
    const scope = secretStatement?.values.at(-1) as string;
    expect(scope).toBe('s3://analytics/my table/데이터/');
    // The invariant that matters: every path DuckDB is asked to scan starts
    // with the scope, so the secret actually covers the read.
    const scanned = duckDb.statements
      .flatMap((statement) => statement.values)
      .filter(
        (value): value is string =>
          typeof value === 'string' && value.startsWith('s3://'),
      );
    expect(scanned.length).toBeGreaterThan(0);
    for (const path of scanned) {
      expect(path.startsWith(scope)).toBe(true);
    }
  });

  it.each([
    {
      label: 'account key',
      credentials: {
        accountName: 'account',
        accountKey:
          'safe-key;BlobEndpoint=http://169.254.169.254/latest/meta-data',
      },
    },
    {
      label: 'SAS token',
      credentials: {
        accountName: 'account',
        sasToken:
          'sv=2026-01-01&sig=safe;BlobEndpoint=http://169.254.169.254/latest/meta-data',
      },
    },
  ])(
    'rejects endpoint injection through an Azure $label',
    async ({ credentials }) => {
      await expect(
        service.testConfiguration({
          name: 'injected-azure',
          format: 'delta',
          storage: 'azure',
          bucket: 'fixtures',
          basePath: 'delta-events',
          credentials,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(duckDb.withConnectionCalls).toBe(0);
    },
  );

  it('keeps Delta versions that do not have commitInfo timestamps', async () => {
    prisma.findUniqueResult = source({ format: 'delta' });
    duckDb.queryRowsResult = [
      { version: '4', timestamp: null, operation: null },
    ];

    await expect(service.history('source-1')).resolves.toEqual([
      { ref: { kind: 'version', version: 4 } },
    ]);
  });

  it('returns only a stable public message for connection-test failures', async () => {
    duckDb.queryError = new Error(
      'remote rejected minio-secret at an internal host',
    );

    await expect(service.testConnection('source-1')).resolves.toEqual({
      success: false,
      error: 'Unable to connect to the lakehouse source',
    });
  });

  it('tests a new configuration without persisting it', async () => {
    await expect(
      service.testConfiguration({
        name: 'candidate',
        format: 'delta',
        storage: 's3-compatible',
        endpoint: 'http://127.0.0.1:9000',
        bucket: 'fixtures',
        basePath: 'delta-events',
        credentials: storedCredentials,
      }),
    ).resolves.toEqual({ success: true });
    expect(prisma.createCalls).toBe(0);
    expect(prisma.updatedData).toBeUndefined();
  });

  it('requires an exact allowlist entry for custom storage endpoints', async () => {
    process.env.LAKEHOUSE_ALLOWED_ENDPOINTS = '';

    await expect(
      service.create(7, 'workspace-1', {
        name: 'blocked',
        format: 'delta',
        storage: 's3-compatible',
        endpoint: 'http://127.0.0.1:9000',
        bucket: 'fixtures',
        basePath: 'delta-events',
        credentials: storedCredentials,
      }),
    ).rejects.toThrow('LAKEHOUSE_ALLOWED_ENDPOINTS');
    expect(prisma.createCalls).toBe(0);
  });

  it('accepts standard Azure endpoints but gates raw BlobEndpoint values', async () => {
    const standard =
      'DefaultEndpointsProtocol=https;AccountName=account;AccountKey=key;EndpointSuffix=core.windows.net';
    prisma.findUniqueResult = source({
      storage: 'azure',
      endpoint: null,
      credentials: encrypt(JSON.stringify({ connectionString: standard })),
    });
    await expect(service.read('source-1', {})).resolves.toEqual(
      duckDb.queryResponse,
    );

    prisma.findUniqueResult = source({
      storage: 'azure',
      endpoint: null,
      credentials: encrypt(
        JSON.stringify({
          connectionString:
            'BlobEndpoint=https://metadata.example;AccountName=account;AccountKey=key',
        }),
      ),
    });
    await expect(service.read('source-1', {})).rejects.toThrow(
      'LAKEHOUSE_ALLOWED_ENDPOINTS',
    );
  });

  it('rejects mixed or provider-irrelevant credential modes', async () => {
    await expect(
      service.create(7, 'workspace-1', {
        name: 'mixed-azure',
        format: 'delta',
        storage: 'azure',
        bucket: 'fixtures',
        basePath: 'delta-events',
        credentials: {
          connectionString:
            'DefaultEndpointsProtocol=https;AccountName=account;AccountKey=key',
          accountName: 'account',
          accountKey: 'key',
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.create(7, 'workspace-1', {
        name: 'gcs-token',
        format: 'delta',
        storage: 'gcs',
        bucket: 'fixtures',
        basePath: 'delta-events',
        credentials: {
          accessKeyId: 'id',
          secretAccessKey: 'secret',
          sessionToken: 'not-supported',
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.createCalls).toBe(0);
  });

  it('rejects simultaneous Azure account-key and SAS rotation', async () => {
    prisma.findUniqueResult = source({
      storage: 'azure',
      endpoint: null,
      credentials: encrypt(
        JSON.stringify({ accountName: 'account', accountKey: 'old-key' }),
      ),
    });

    await expect(
      service.update('source-1', {
        credentials: {
          accountKey: 'new-key',
          sasToken: 'sv=1&sig=secret',
        },
      }),
    ).rejects.toThrow('mutually exclusive');
    expect(prisma.updatedData).toBeUndefined();
  });

  it('requires fresh credentials when the Azure account identity changes', async () => {
    prisma.findUniqueResult = source({
      storage: 'azure',
      endpoint: null,
      credentials: encrypt(
        JSON.stringify({ accountName: 'oldaccount', accountKey: 'old-key' }),
      ),
    });

    await expect(
      service.update('source-1', {
        credentials: { accountName: 'newaccount' },
      }),
    ).rejects.toThrow(
      'Changing Azure accountName requires a fresh accountKey or sasToken',
    );
    expect(prisma.updatedData).toBeUndefined();
  });

  it('rejects an invalid protocol even when a raw Azure BlobEndpoint is allowlisted', async () => {
    await expect(
      service.create(7, 'workspace-1', {
        name: 'invalid-azure-protocol',
        format: 'delta',
        storage: 'azure',
        bucket: 'fixtures',
        basePath: 'delta-events',
        credentials: {
          connectionString:
            'DefaultEndpointsProtocol=ftp;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;AccountName=account;AccountKey=key',
        },
      }),
    ).rejects.toThrow('invalid endpoint protocol');
    expect(prisma.createCalls).toBe(0);
  });

  it('invalidates DuckDB when a temporary Delta attachment cannot be removed', async () => {
    duckDb.runError = (statement) =>
      statement.sql.startsWith('DETACH')
        ? new Error('detach failed with sensitive details')
        : undefined;

    await expect(
      service.read('source-1', {
        asOf: { kind: 'version', version: 1 },
      }),
    ).rejects.toThrow('Lakehouse query failed');
    expect(duckDb.invalidateCalls).toBe(1);
    expect(duckDb.statements.at(-1)?.sql).toContain('DROP SECRET');
  });
  it.each([
    [
      { format: 'iceberg' as const, basePath: 'iceberg/events' },
      'require a .metadata.json path',
    ],
    [
      { format: 'delta' as const, basePath: 'delta-events/_delta_log' },
      'table root, not _delta_log',
    ],
    [
      { format: 'delta' as const, basePath: 'delta-events/_delta_log/0.json' },
      'table root, not _delta_log',
    ],
    [{ format: 'delta' as const, basePath: '   ' }, 'require basePath'],
  ])(
    'rejects a direct-metadata path that does not name the format %#',
    async (patch, message) => {
      await expect(
        service.create(7, 'workspace-1', {
          name: 'bad-path',
          storage: 's3-compatible',
          endpoint: 'http://127.0.0.1:9000',
          region: 'us-east-1',
          bucket: 'lakehouse-fixtures',
          credentials: storedCredentials,
          ...patch,
        }),
      ).rejects.toThrow(message);
      expect(prisma.createCalls).toBe(0);
    },
  );

  it('rejects local paths that do not exist or are not file URIs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'wafflebase-lakehouse-root-'));
    process.env.LAKEHOUSE_ALLOW_LOCAL_PATHS = 'true';
    process.env.LAKEHOUSE_LOCAL_ROOT = root;

    try {
      await expect(
        service.create(7, 'workspace-1', {
          name: 'missing-events',
          format: 'delta',
          storage: 'local',
          basePath: join(root, 'does-not-exist'),
          credentials: {},
        }),
      ).rejects.toThrow('must exist');
      await expect(
        service.create(7, 'workspace-1', {
          name: 'remote-file-uri',
          format: 'delta',
          storage: 'local',
          // A file URI with a remote host is not a local path.
          basePath: 'file://nas.example.com/share/events',
          credentials: {},
        }),
      ).rejects.toThrow('Invalid local lakehouse file URI');
      expect(prisma.createCalls).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    [
      'DefaultEndpointsProtocol=http;AccountName=account;AccountKey=key;EndpointSuffix=core.windows.net',
      'require HTTPS',
    ],
    [
      'DefaultEndpointsProtocol=https;AccountName=account;AccountKey=key;EndpointSuffix=.bad.suffix',
      'invalid EndpointSuffix',
    ],
    [
      'DefaultEndpointsProtocol=https;AccountName=account;AccountKey=key;EndpointSuffix=blob.example.com',
      'not allowed',
    ],
  ])(
    'validates the standard and custom-suffix Azure connection string forms %#',
    async (connectionString, message) => {
      await expect(
        service.create(7, 'workspace-1', {
          name: 'azure-source',
          format: 'delta',
          storage: 'azure',
          bucket: 'fixtures',
          basePath: 'delta-events',
          credentials: { connectionString },
        }),
      ).rejects.toThrow(message);
      expect(prisma.createCalls).toBe(0);
    },
  );

  it('accepts a custom Azure EndpointSuffix whose derived endpoint is allowlisted', async () => {
    process.env.LAKEHOUSE_ALLOWED_ENDPOINTS =
      'http://account.blob.azurite.local';

    await service.create(7, 'workspace-1', {
      name: 'azure-suffix',
      format: 'delta',
      storage: 'azure',
      bucket: 'fixtures',
      basePath: 'delta-events',
      credentials: {
        connectionString:
          'DefaultEndpointsProtocol=http;AccountName=account;AccountKey=key;EndpointSuffix=azurite.local',
      },
    });
    expect(prisma.createCalls).toBe(1);
  });

  describe('Azure credential merge on update', () => {
    const azureSource = () =>
      source({
        storage: 'azure',
        endpoint: null,
        credentials: encrypt(
          JSON.stringify({ accountName: 'account', accountKey: 'old-key' }),
        ),
      });
    const updated = () => {
      if (!prisma.updatedCredentials) {
        throw new Error('Expected encrypted credentials in update call');
      }
      return JSON.parse(decrypt(prisma.updatedCredentials)) as unknown;
    };

    it('rotates the account key and keeps the stored account name', async () => {
      prisma.findUniqueResult = azureSource();
      await service.update('source-1', {
        credentials: { accountKey: 'new-key' },
      });
      expect(updated()).toEqual({
        accountName: 'account',
        accountKey: 'new-key',
      });
    });

    it('switches from an account key to a SAS token without keeping the key', async () => {
      prisma.findUniqueResult = azureSource();
      await service.update('source-1', {
        credentials: { sasToken: '?sv=1&sig=secret' },
      });
      expect(updated()).toEqual({
        accountName: 'account',
        sasToken: 'sv=1&sig=secret',
      });
    });

    it('binds a SAS token to the standard public endpoint without an allowlist entry', async () => {
      process.env.LAKEHOUSE_ALLOWED_ENDPOINTS = '';
      prisma.findUniqueResult = source({
        storage: 'azure',
        endpoint: null,
        bucket: 'fixtures',
        basePath: 'delta-events',
        credentials: encrypt(
          JSON.stringify({
            accountName: 'account',
            sasToken: 'sv=1&sig=secret',
          }),
        ),
      });

      await service.read('source-1', {});

      expect(duckDb.statements[0].values[0]).toBe(
        'DefaultEndpointsProtocol=https;AccountName=account;SharedAccessSignature=sv=1&sig=secret;EndpointSuffix=core.windows.net',
      );
    });

    it('re-sending the same account name alone keeps the stored key', async () => {
      prisma.findUniqueResult = azureSource();
      await service.update('source-1', {
        credentials: { accountName: 'account' },
      });
      expect(updated()).toEqual({
        accountName: 'account',
        accountKey: 'old-key',
      });
    });

    it('replaces account credentials with a connection string', async () => {
      prisma.findUniqueResult = azureSource();
      await service.update('source-1', {
        credentials: {
          connectionString:
            'DefaultEndpointsProtocol=https;AccountName=account;AccountKey=key;EndpointSuffix=core.windows.net',
        },
      });
      expect(updated()).toEqual({
        connectionString:
          'DefaultEndpointsProtocol=https;AccountName=account;AccountKey=key;EndpointSuffix=core.windows.net',
      });
    });

    it('rejects combining a connection string with account credentials', async () => {
      prisma.findUniqueResult = azureSource();
      await expect(
        service.update('source-1', {
          credentials: {
            connectionString:
              'DefaultEndpointsProtocol=https;AccountName=account;AccountKey=key',
            accountKey: 'new-key',
          },
        }),
      ).rejects.toThrow('cannot be combined');
      expect(prisma.updatedData).toBeUndefined();
    });
  });

  it('maps engine timeouts and unavailability to 408 and 503', async () => {
    prisma.findUniqueResult = source();

    duckDb.queryError = new DuckDbQueryTimeoutError(30_000);
    await expect(service.read('source-1', {})).rejects.toBeInstanceOf(
      RequestTimeoutException,
    );

    duckDb.queryError = new DuckDbUnavailableError();
    await expect(service.read('source-1', {})).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    // Connection tests surface the engine's own (credential-free) message.
    await expect(service.testConnection('source-1')).resolves.toEqual({
      success: false,
      error: 'Lakehouse query engine is restarting',
    });
  });

  it('reports malformed history rows as a query failure without leaking them', async () => {
    prisma.findUniqueResult = source({
      format: 'iceberg',
      basePath: 'iceberg/events/metadata/00003.metadata.json',
    });
    duckDb.queryRowsResult = [
      { snapshot_id: 'not-a-number', sequence_number: '1', timestamp_ms: 1 },
    ];
    const error = await rejectedError(service.history('source-1'));
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toBe('Lakehouse query failed');

    duckDb.queryRowsResult = [
      { snapshot_id: '1', sequence_number: '1', timestamp_ms: 'yesterday' },
    ];
    await expect(service.history('source-1')).rejects.toThrow(
      'Lakehouse query failed',
    );

    // Digit-string epoch millis (what DuckDB's JSON rows carry) are accepted.
    duckDb.queryRowsResult = [
      { snapshot_id: '1', sequence_number: '1', timestamp_ms: '1000' },
    ];
    await expect(service.history('source-1')).resolves.toEqual([
      {
        ref: { kind: 'snapshot', snapshotId: '1' },
        timestamp: '1970-01-01T00:00:01.000Z',
      },
    ]);
  });

  it('reports a duplicate source name as a conflict', async () => {
    prisma.createError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: 'test' },
    );

    await expect(
      service.create(7, 'workspace-1', {
        name: 'events',
        format: 'delta',
        storage: 's3-compatible',
        endpoint: 'http://127.0.0.1:9000',
        region: 'us-east-1',
        bucket: 'lakehouse-fixtures',
        basePath: 'delta-events',
        credentials: storedCredentials,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('LakehouseService catalog mode and timestamp time travel', () => {
  let prisma: MockPrisma;
  let duckDb: MockDuckDb;
  let service: LakehouseService;

  const catalogSource = (overrides: Partial<LakehouseSource> = {}) =>
    source({
      format: 'iceberg',
      storage: 's3-compatible',
      endpoint: 'http://127.0.0.1:9000',
      bucket: 'lakehouse-fixtures',
      basePath: 'analytics',
      catalogMode: 'rest_catalog',
      catalogUri: 'http://127.0.0.1:8181/v1',
      credentials: encrypt(
        JSON.stringify({ ...storedCredentials, catalogToken: 'bearer-1' }),
      ),
      ...overrides,
    });

  beforeEach(() => {
    process.env.DATASOURCE_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
    process.env.LAKEHOUSE_ALLOWED_ENDPOINTS = [
      'http://127.0.0.1:9000',
      'http://127.0.0.1:8181',
    ].join(',');
    prisma = new MockPrisma();
    duckDb = new MockDuckDb();
    service = new LakehouseService(
      prisma as unknown as PrismaService,
      duckDb as unknown as DuckDbService,
    );
  });

  it('rejects creating a unity source until an attach path exists', async () => {
    await expect(
      service.create(7, 'workspace-1', {
        name: 'unity-source',
        format: 'iceberg',
        storage: 's3',
        bucket: 'lake',
        catalogMode: 'unity',
        catalogUri: 'https://unity.example.com',
        credentials: storedCredentials,
      }),
    ).rejects.toThrow('unity catalog mode is not supported');
  });

  it.each([
    [{ catalogUri: undefined }, 'require catalogUri'],
    [{ catalogUri: 'https://evil.example.com/v1' }, 'not allowed'],
    [{ bucket: undefined }, 'requires bucket'],
    [{ format: 'delta' as const }, 'requires the iceberg format'],
  ])(
    'rejects an invalid rest_catalog configuration %#',
    async (patch, message) => {
      await expect(
        service.create(7, 'workspace-1', {
          name: 'catalog-source',
          format: 'iceberg',
          storage: 's3-compatible',
          endpoint: 'http://127.0.0.1:9000',
          region: 'us-east-1',
          bucket: 'lakehouse-fixtures',
          catalogMode: 'rest_catalog',
          catalogUri: 'http://127.0.0.1:8181/v1',
          credentials: storedCredentials,
          ...patch,
        }),
      ).rejects.toThrow(message);
    },
  );

  it('lists catalog tables through attach, and always detaches', async () => {
    prisma.findUniqueResult = catalogSource();
    duckDb.queryRowsResult = [
      { schema: 'analytics.daily', name: 'events' },
      { schema: 'default', name: 'plain' },
    ];

    const tables = await service.tables('source-1');

    expect(tables).toEqual([
      { namespace: ['analytics', 'daily'], table: 'events' },
      { namespace: ['default'], table: 'plain' },
    ]);
    const sql = duckDb.statements.map((statement) => statement.sql);
    expect(sql.some((s) => s.includes('TYPE iceberg, TOKEN ?'))).toBe(true);
    expect(sql.some((s) => s.startsWith('ATTACH'))).toBe(true);
    expect(sql.some((s) => s.startsWith('DETACH'))).toBe(true);
    // Attach happens after the storage+catalog secrets, detach before cleanup.
    const attachIndex = sql.findIndex((s) => s.startsWith('ATTACH'));
    const detachIndex = sql.findIndex((s) => s.startsWith('DETACH'));
    expect(attachIndex).toBeGreaterThan(0);
    expect(detachIndex).toBeGreaterThan(attachIndex);
  });

  it('rejects tables() for a direct-metadata source', async () => {
    prisma.findUniqueResult = source();
    await expect(service.tables('source-1')).rejects.toThrow(
      'only available for catalog-mode sources',
    );
  });

  it('reads a catalog table by namespace reference', async () => {
    prisma.findUniqueResult = catalogSource();

    const result = await service.read('source-1', {
      table: { namespace: ['analytics'], table: 'events' },
    });

    expect(result.rowCount).toBe(1);
    expect(duckDb.queryStatement?.sql).toMatch(
      /^SELECT \* FROM "lakehouse_[0-9a-f]+"\."analytics"\."events" LIMIT \?$/,
    );
  });

  it('requires a table reference and rejects asOf for catalog reads', async () => {
    prisma.findUniqueResult = catalogSource();
    await expect(service.read('source-1', {})).rejects.toThrow(
      'require a { namespace, table } reference',
    );
    await expect(
      service.read('source-1', {
        table: { namespace: ['analytics'], table: 'events' },
        asOf: { kind: 'snapshot', snapshotId: '1' },
      }),
    ).rejects.toThrow('only available for direct-metadata sources');
  });

  it('rejects history() for a catalog source', async () => {
    prisma.findUniqueResult = catalogSource();
    await expect(service.history('source-1')).rejects.toThrow(
      'only available for direct-metadata sources',
    );
  });

  it('resolves a timestamp asOf to the commit at or before it', async () => {
    prisma.findUniqueResult = source(); // delta, direct metadata
    duckDb.queryRowsResult = [
      { version: 2, timestamp: 3000, operation: 'WRITE' },
      { version: 1, timestamp: 2000, operation: 'WRITE' },
      { version: 0, timestamp: 1000, operation: 'WRITE' },
    ];

    await service.read('source-1', {
      asOf: { kind: 'timestamp', iso: new Date(2500).toISOString() },
    });

    // The resolved commit is version 1 → the Delta ATTACH time-travel path.
    expect(duckDb.queryStatement?.sql).toContain('AT (VERSION => ?)');
    expect(duckDb.queryStatement?.values[0]).toBe(1);
  });

  it('resolves an Iceberg version asOf as a sequence number, per design §1', async () => {
    // Design §1 types `version` as "Delta version / Iceberg sequence". An
    // Iceberg commit carries BOTH a sequence number and a snapshot id, and
    // iceberg_scan selects only by snapshot id — passing the sequence through
    // fails with "Could not find snapshot with id 2" — so the sequence has to
    // be resolved through the history listing first.
    prisma.findUniqueResult = source({
      format: 'iceberg',
      basePath: 'iceberg/default/events/metadata/00003-abc.metadata.json',
    });
    duckDb.queryRowsResult = [
      {
        sequence_number: 3,
        snapshot_id: '7953107897879720084',
        timestamp_ms: 3000,
      },
      {
        sequence_number: 2,
        snapshot_id: '4492391797763991711',
        timestamp_ms: 2000,
      },
      {
        sequence_number: 1,
        snapshot_id: '7989807407367529971',
        timestamp_ms: 1000,
      },
    ];

    await service.read('source-1', { asOf: { kind: 'version', version: 2 } });

    // Snapshot ids bind as BIGINT, matching planLakehouseRead's contract.
    expect(duckDb.queryStatement?.sql).toContain('snapshot_from_id');
    expect(duckDb.queryStatement?.values).toContain(4492391797763991711n);
  });

  it('rejects an Iceberg version that names no commit', async () => {
    prisma.findUniqueResult = source({
      format: 'iceberg',
      basePath: 'iceberg/default/events/metadata/00003-abc.metadata.json',
    });
    duckDb.queryRowsResult = [
      {
        sequence_number: 1,
        snapshot_id: '7989807407367529971',
        timestamp_ms: 1000,
      },
    ];

    await expect(
      service.read('source-1', { asOf: { kind: 'version', version: 9 } }),
    ).rejects.toThrow('No commit exists with that version');
  });

  it('still rejects a snapshot asOf on a delta source', async () => {
    prisma.findUniqueResult = source(); // delta

    await expect(
      service.read('source-1', {
        asOf: { kind: 'snapshot', snapshotId: '7989807407367529971' },
      }),
    ).rejects.toThrow('does not match the delta source format');
  });

  it.each([
    ['DETACH', (sql: string) => sql.startsWith('DETACH')],
    [
      'the catalog secret DROP',
      (sql: string) =>
        sql.startsWith('DROP SECRET') && sql.includes('_catalog'),
    ],
  ])(
    'invalidates DuckDB when catalog cleanup fails on %s',
    async (_label, failing) => {
      prisma.findUniqueResult = catalogSource();
      duckDb.queryRowsResult = [{ schema: 'default', name: 'events' }];
      duckDb.runError = (statement) =>
        failing(statement.sql)
          ? new Error('cleanup failed with sensitive details')
          : undefined;

      const error = await rejectedError(service.tables('source-1'));
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe('Lakehouse query failed');
      expect(duckDb.invalidateCalls).toBe(1);
      // The storage secret is still dropped after the failed catalog cleanup.
      const sql = duckDb.statements.map((statement) => statement.sql);
      expect(sql.at(-1)).toMatch(/^DROP SECRET IF EXISTS /);
      expect(sql.at(-1)).not.toContain('_catalog');
    },
  );

  it('rejects a timestamp earlier than every commit', async () => {
    prisma.findUniqueResult = source();
    duckDb.queryRowsResult = [
      { version: 0, timestamp: 1000, operation: 'WRITE' },
    ];

    await expect(
      service.read('source-1', {
        asOf: { kind: 'timestamp', iso: new Date(500).toISOString() },
      }),
    ).rejects.toThrow('No commit exists at or before');
  });
});
