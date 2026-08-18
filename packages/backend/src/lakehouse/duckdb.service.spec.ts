import {
  DuckDBConnection,
  DuckDBInstance,
  DuckDBResultReader,
  DuckDBTypeId,
} from '@duckdb/node-api';
import {
  DuckDbPoolExhaustedError,
  DuckDbQueryTimeoutError,
  DuckDbService,
  DuckDbUnavailableError,
} from './duckdb.service';
import { LakehouseSecretPlan } from './lakehouse.types';

jest.mock('@duckdb/node-api', () => {
  const actual =
    jest.requireActual<typeof import('@duckdb/node-api')>('@duckdb/node-api');
  return {
    ...actual,
    DuckDBInstance: {
      create: jest.fn(),
    },
  };
});

type MockConnection = {
  run: jest.MockedFunction<
    (sql: string, values?: unknown[]) => Promise<unknown>
  >;
  runAndReadAll: jest.MockedFunction<
    (sql: string, values?: unknown[]) => Promise<DuckDBResultReader>
  >;
  interrupt: jest.MockedFunction<() => void>;
  closeSync: jest.MockedFunction<() => void>;
};

function mockConnection(): MockConnection {
  return {
    run: jest
      .fn<Promise<unknown>, [sql: string, values?: unknown[]]>()
      .mockResolvedValue(undefined),
    runAndReadAll: jest.fn<
      Promise<DuckDBResultReader>,
      [sql: string, values?: unknown[]]
    >(),
    interrupt: jest.fn<void, []>(),
    closeSync: jest.fn<void, []>(),
  };
}

type MockInstance = {
  connect: jest.MockedFunction<() => Promise<DuckDBConnection>>;
  closeSync: jest.MockedFunction<() => void>;
};

function mockInstance(connections: MockConnection[]): MockInstance {
  return {
    connect: jest.fn<Promise<DuckDBConnection>, []>().mockImplementation(() => {
      const connection = connections.shift();
      if (!connection) {
        return Promise.reject(new Error('No mock DuckDB connection'));
      }
      return Promise.resolve(connection as unknown as DuckDBConnection);
    }),
    closeSync: jest.fn<void, []>(),
  };
}

function secret(scope: string, name = 'request_secret'): LakehouseSecretPlan {
  const normalizedScope = scope.endsWith('/') ? scope : `${scope}/`;
  return {
    name,
    scope: normalizedScope,
    create: { sql: `CREATE SECRET ${name}`, values: [] },
    cleanup: { sql: `DROP SECRET ${name}`, values: [] },
  };
}

// Jest replaces this static factory; referencing it unbound is intentional.
// eslint-disable-next-line @typescript-eslint/unbound-method
const createInstanceMock = jest.mocked(DuckDBInstance.create);

describe('DuckDbService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.useRealTimers();
    process.env = {
      ...originalEnv,
      LAKEHOUSE_DUCKDB_POOL_SIZE: '1',
      LAKEHOUSE_DUCKDB_MAX_PENDING: '1',
      LAKEHOUSE_QUERY_TIMEOUT_MS: '100',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('initializes required extensions once and reuses a pooled connection', async () => {
    const connection = mockConnection();
    const instance = mockInstance([connection]);
    createInstanceMock.mockResolvedValue(instance as unknown as DuckDBInstance);
    const service = new DuckDbService();

    const first = await service.withConnection((leased) =>
      Promise.resolve(leased),
    );
    const second = await service.withConnection((leased) =>
      Promise.resolve(leased),
    );

    expect(first).toBe(connection);
    expect(second).toBe(connection);
    expect(instance.connect).toHaveBeenCalledTimes(1);
    // No INSTALL: the extensions are already on disk (a pre-bundled image, or
    // a developer machine that downloaded them once), so initialization does
    // not reach for the network.
    expect(connection.run.mock.calls.map(([sql]) => sql)).toEqual([
      'LOAD httpfs',
      'LOAD iceberg',
      'LOAD delta',
      'LOAD azure',
      'SET allow_community_extensions = false',
      'SET allow_unsigned_extensions = false',
      'SET autoinstall_known_extensions = false',
      'SET autoload_known_extensions = false',
      'SET allow_persistent_secrets = false',
      'SET allow_unredacted_secrets = false',
      'SET enable_global_s3_configuration = false',
      'SET enable_external_file_cache = false',
      'SET enable_curl_server_cert_verification = true',
      'SET enable_server_cert_verification = true',
    ]);

    await service.onModuleDestroy();
    expect(connection.closeSync).toHaveBeenCalledTimes(1);
    expect(instance.closeSync).toHaveBeenCalledTimes(1);
  });

  it('passes the configured extension directory to DuckDB', async () => {
    // The production image pre-populates this directory at build time, so a
    // deployment with no egress to extensions.duckdb.org still serves reads.
    process.env.LAKEHOUSE_DUCKDB_EXTENSION_DIR = '/app/.duckdb-extensions';
    const connection = mockConnection();
    const instance = mockInstance([connection]);
    createInstanceMock.mockResolvedValue(instance as unknown as DuckDBInstance);
    const service = new DuckDbService();

    await service.withConnection((leased) => Promise.resolve(leased));

    expect(createInstanceMock).toHaveBeenCalledWith(
      ':memory:',
      expect.objectContaining({
        extension_directory: '/app/.duckdb-extensions',
      }),
    );
    expect(
      connection.run.mock.calls
        .map(([sql]) => sql)
        .filter((sql) => sql.startsWith('INSTALL')),
    ).toEqual([]);

    await service.onModuleDestroy();
  });

  it('falls back to INSTALL when an extension is not on disk', async () => {
    // An empty extension directory — a developer machine, or an image built
    // without the bundling step — must still work: the LOAD fails and the
    // service downloads that one extension rather than giving up.
    const connection = mockConnection();
    let deltaLoads = 0;
    connection.run.mockImplementation((sql: string) => {
      if (sql === 'LOAD delta') {
        deltaLoads += 1;
        if (deltaLoads === 1) {
          return Promise.reject(
            new Error('IO Error: Extension "delta" not found'),
          );
        }
      }
      return Promise.resolve(undefined);
    });
    const instance = mockInstance([connection]);
    createInstanceMock.mockResolvedValue(instance as unknown as DuckDBInstance);
    const service = new DuckDbService();

    await service.withConnection((leased) => Promise.resolve(leased));

    const sql = connection.run.mock.calls.map(([statement]) => statement);
    expect(sql).toContain('INSTALL delta');
    // Only the missing one is downloaded, and it is loaded afterwards.
    expect(sql.filter((s) => s.startsWith('INSTALL'))).toEqual([
      'INSTALL delta',
    ]);
    expect(sql.indexOf('INSTALL delta')).toBeLessThan(
      sql.lastIndexOf('LOAD delta'),
    );

    await service.onModuleDestroy();
  });

  it('rebuilds the instance once when hardening fails on a cold start', async () => {
    // Observed on every fresh container: after the extensions are downloaded
    // for the first time, the first `SET allow_persistent_secrets` in the
    // process fails with "Changing Secret Manager settings after the secret
    // manager is used is not allowed!", and the very next instance is fine.
    // Without a retry the first lakehouse request of every new container
    // fails once and only the second succeeds.
    const poisoned = mockConnection();
    poisoned.run.mockImplementation((sql: string) =>
      sql === 'SET allow_persistent_secrets = false'
        ? Promise.reject(
            new Error(
              'Invalid Input Error: Changing Secret Manager settings after the secret manager is used is not allowed!',
            ),
          )
        : Promise.resolve(undefined),
    );
    const poisonedInstance = mockInstance([poisoned]);
    const connection = mockConnection();
    const instance = mockInstance([connection]);
    createInstanceMock
      .mockResolvedValueOnce(poisonedInstance as unknown as DuckDBInstance)
      .mockResolvedValueOnce(instance as unknown as DuckDBInstance);
    const service = new DuckDbService();

    const leased = await service.withConnection((c) => Promise.resolve(c));

    expect(leased).toBe(connection);
    expect(createInstanceMock).toHaveBeenCalledTimes(2);
    // The poisoned instance is fully torn down before the retry.
    expect(poisoned.closeSync).toHaveBeenCalledTimes(1);
    expect(poisonedInstance.closeSync).toHaveBeenCalledTimes(1);
    // The retry runs the whole bootstrap again, hardening included.
    expect(connection.run.mock.calls.map(([sql]) => sql)).toContain(
      'SET allow_persistent_secrets = false',
    );

    await service.onModuleDestroy();
  });

  it('does not retry hardening more than once', async () => {
    const failing = () => {
      const c = mockConnection();
      c.run.mockImplementation((sql: string) =>
        sql === 'SET allow_persistent_secrets = false'
          ? Promise.reject(new Error('still poisoned'))
          : Promise.resolve(undefined),
      );
      return c;
    };
    const first = mockInstance([failing()]);
    const second = mockInstance([failing()]);
    // Only two instances are queued: a third attempt would surface as the
    // "No mock DuckDB connection" rejection from a fresh default mock, not as
    // 'still poisoned', so the assertion below also proves there is no third.
    createInstanceMock
      .mockResolvedValueOnce(first as unknown as DuckDBInstance)
      .mockResolvedValueOnce(second as unknown as DuckDBInstance);
    const service = new DuckDbService();

    await expect(
      service.withConnection((c) => Promise.resolve(c)),
    ).rejects.toThrow('still poisoned');
    expect(createInstanceMock).toHaveBeenCalledTimes(2);
    expect(first.closeSync).toHaveBeenCalledTimes(1);
    expect(second.closeSync).toHaveBeenCalledTimes(1);
  });

  it('maps DuckDB JSON rows to the datasource response envelope', async () => {
    const connection = mockConnection();
    connection.runAndReadAll.mockResolvedValue({
      getRowObjectsJson: () => [
        { id: '9223372036854775807', nested: { ok: true } },
        { id: '2', nested: null },
      ],
      columnNames: () => ['id', 'nested'],
      columnTypes: () => [
        { typeId: DuckDBTypeId.BIGINT },
        { typeId: DuckDBTypeId.STRUCT },
      ],
    } as unknown as DuckDBResultReader);
    const instance = mockInstance([connection]);
    createInstanceMock.mockResolvedValue(instance as unknown as DuckDBInstance);
    const service = new DuckDbService();

    const result = await service.withConnection((leased) =>
      service.query(
        leased,
        { sql: 'SELECT id, nested FROM fixture LIMIT ?', values: [2] },
        1,
      ),
    );

    expect(result).toMatchObject({
      columns: [
        { name: 'id', dataTypeID: DuckDBTypeId.BIGINT },
        { name: 'nested', dataTypeID: DuckDBTypeId.STRUCT },
      ],
      rows: [{ id: '9223372036854775807', nested: { ok: true } }],
      rowCount: 1,
      truncated: true,
    });
    expect(connection.runAndReadAll).toHaveBeenCalledWith(
      'SELECT id, nested FROM fixture LIMIT ?',
      [2],
    );
  });

  it('reports a full-but-not-over result as complete, not truncated', async () => {
    // The read plan asks for maxRows + 1, so exactly maxRows rows means the
    // table ended right at the cap. Flipping the comparison to `>=` would
    // label a complete 10,000-row table as truncated in the UI.
    const connection = mockConnection();
    connection.runAndReadAll.mockResolvedValue({
      getRowObjectsJson: () => [{ id: '1' }, { id: '2' }],
      columnNames: () => ['id'],
      columnTypes: () => [{ typeId: DuckDBTypeId.BIGINT }],
    } as unknown as DuckDBResultReader);
    const instance = mockInstance([connection]);
    createInstanceMock.mockResolvedValue(instance as unknown as DuckDBInstance);
    const service = new DuckDbService();

    const result = await service.withConnection((leased) =>
      service.query(
        leased,
        { sql: 'SELECT id FROM fixture LIMIT ?', values: [3] },
        2,
      ),
    );

    expect(result).toMatchObject({ rowCount: 2, truncated: false });

    await service.onModuleDestroy();
  });

  it('clamps pool size and rejects a malformed memory limit', () => {
    // Both guards are load-bearing: an unclamped pool size would open more
    // DuckDB connections than MAX_POOL_SIZE, and an unvalidated memory limit
    // is interpolated into a SET statement at instance creation.
    process.env.LAKEHOUSE_DUCKDB_POOL_SIZE = '1000';
    process.env.LAKEHOUSE_DUCKDB_MEMORY_LIMIT = '512MB; DROP TABLE x';
    const service = new DuckDbService();

    expect(
      (service as unknown as { poolSize: number }).poolSize,
    ).toBeLessThanOrEqual(8);
    expect((service as unknown as { memoryLimit: string }).memoryLimit).toBe(
      '512MB',
    );
  });

  it('interrupts a timed-out query and rebuilds the poisoned instance', async () => {
    jest.useFakeTimers();
    const connection = mockConnection();
    const replacement = mockConnection();
    connection.interrupt.mockImplementation(() => {
      throw new Error('Connection closed during interrupt');
    });
    const instance = mockInstance([connection]);
    const replacementInstance = mockInstance([replacement]);
    createInstanceMock
      .mockResolvedValueOnce(instance as unknown as DuckDBInstance)
      .mockResolvedValueOnce(replacementInstance as unknown as DuckDBInstance);
    const service = new DuckDbService();
    let rejectOperation: (error: Error) => void = () => undefined;
    let markStarted: () => void = () => undefined;
    const operationStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });

    const timedOut = service.withConnection(() => {
      markStarted();
      return new Promise((_resolve, reject) => {
        rejectOperation = reject;
      });
    }, 100);
    await operationStarted;
    jest.advanceTimersByTime(100);
    expect(connection.interrupt).toHaveBeenCalledTimes(1);
    rejectOperation(new Error('Interrupted'));

    await expect(timedOut).rejects.toBeInstanceOf(DuckDbQueryTimeoutError);
    await Promise.resolve();
    await Promise.resolve();
    await expect(
      service.withConnection((leased) => Promise.resolve(leased)),
    ).resolves.toBe(replacement);
    expect(connection.closeSync).toHaveBeenCalledTimes(1);
    expect(instance.closeSync).toHaveBeenCalledTimes(1);
  });

  it('bounds the pending query queue', async () => {
    const connection = mockConnection();
    const instance = mockInstance([connection]);
    createInstanceMock.mockResolvedValue(instance as unknown as DuckDBInstance);
    const service = new DuckDbService();
    let finishFirst: () => void = () => undefined;
    let markFirstStarted: () => void = () => undefined;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });

    const first = service.withConnection(() => {
      markFirstStarted();
      return new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
    }, 1_000);
    await firstStarted;
    const queued = service.withConnection(
      () => Promise.resolve('queued'),
      1_000,
    );

    await expect(
      service.withConnection(() => Promise.resolve('overflow'), 1_000),
    ).rejects.toBeInstanceOf(DuckDbPoolExhaustedError);

    finishFirst();
    await first;
    await expect(queued).resolves.toBe('queued');
  });

  it('serializes secret-bearing work even when another connection is free', async () => {
    process.env.LAKEHOUSE_DUCKDB_POOL_SIZE = '2';
    const firstConnection = mockConnection();
    const secondConnection = mockConnection();
    const instance = mockInstance([firstConnection, secondConnection]);
    createInstanceMock.mockResolvedValue(instance as unknown as DuckDBInstance);
    const service = new DuckDbService();
    const requestSecret = secret('s3://fixtures/table-a');
    let started = 0;
    let markFirstStarted = (): void => undefined;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    let releaseFirst = (): void => undefined;
    const first = service.withStorageSecret(
      requestSecret,
      () => {
        started += 1;
        markFirstStarted();
        return new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      },
      1_000,
    );
    await firstStarted;
    const second = service.withStorageSecret(
      secret('s3://fixtures/table-b', 'second'),
      () => {
        started += 1;
        return Promise.resolve();
      },
      1_000,
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(started).toBe(1);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(started).toBe(2);
  });

  it('serializes secretless table work with secret-bearing work', async () => {
    process.env.LAKEHOUSE_DUCKDB_POOL_SIZE = '2';
    const firstConnection = mockConnection();
    const secondConnection = mockConnection();
    const instance = mockInstance([firstConnection, secondConnection]);
    createInstanceMock.mockResolvedValue(instance as unknown as DuckDBInstance);
    const service = new DuckDbService();
    let markFirstStarted = (): void => undefined;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    let releaseFirst = (): void => undefined;
    let secondStarted = false;

    const first = service.withStorageSecret(
      secret('s3://fixtures/table-a', 'first'),
      () => {
        markFirstStarted();
        return new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      },
      1_000,
    );
    await firstStarted;
    const second = service.withStorageSecret(
      undefined,
      () => {
        secondStarted = true;
        return Promise.resolve('second');
      },
      1_000,
    );

    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(secondStarted).toBe(false);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      'second',
    ]);
    expect(secondStarted).toBe(true);
  });

  it('requires a temporary secret scope to end with a separator', async () => {
    const service = new DuckDbService();
    const invalidSecret = secret('s3://fixtures/table');
    invalidSecret.scope = 's3://fixtures/table';

    await expect(
      service.withStorageSecret(invalidSecret, () => Promise.resolve()),
    ).rejects.toThrow('end with a separator');
    expect(createInstanceMock).not.toHaveBeenCalled();
  });

  it('includes connection acquisition in the wall-clock timeout', async () => {
    jest.useFakeTimers();
    const connection = mockConnection();
    const instance = mockInstance([connection]);
    createInstanceMock.mockResolvedValue(instance as unknown as DuckDBInstance);
    const service = new DuckDbService();
    let markStarted = (): void => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let finishFirst = (): void => undefined;
    const first = service.withConnection(() => {
      markStarted();
      return new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
    }, 1_000);
    await started;

    const queued = service.withConnection(() => Promise.resolve(), 100);
    jest.advanceTimersByTime(100);
    await expect(queued).rejects.toBeInstanceOf(DuckDbQueryTimeoutError);
    expect(connection.interrupt).not.toHaveBeenCalled();

    finishFirst();
    await first;
  });

  it('returns at the deadline and does not reuse a still-running lease', async () => {
    jest.useFakeTimers();
    const connection = mockConnection();
    const instance = mockInstance([connection]);
    createInstanceMock.mockResolvedValue(instance as unknown as DuckDBInstance);
    const service = new DuckDbService();
    let markStarted = (): void => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const timedOut = service.withConnection(() => {
      markStarted();
      return new Promise<never>(() => undefined);
    }, 100);
    await started;
    jest.advanceTimersByTime(100);

    await expect(timedOut).rejects.toBeInstanceOf(DuckDbQueryTimeoutError);
    await expect(
      service.withConnection(() => Promise.resolve()),
    ).rejects.toBeInstanceOf(DuckDbUnavailableError);
    expect(connection.closeSync).not.toHaveBeenCalled();

    await service.onModuleDestroy();
    expect(connection.closeSync).toHaveBeenCalledTimes(1);
  });

  it('abandons a lease that ignores its interrupt and rebuilds the engine', async () => {
    jest.useFakeTimers();
    const stuck = mockConnection();
    const replacement = mockConnection();
    const instance = mockInstance([stuck]);
    const replacementInstance = mockInstance([replacement]);
    createInstanceMock
      .mockResolvedValueOnce(instance as unknown as DuckDBInstance)
      .mockResolvedValueOnce(replacementInstance as unknown as DuckDBInstance);
    const service = new DuckDbService();
    let markStarted = (): void => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let settleOrphan = (): void => undefined;
    const timedOut = service.withConnection(() => {
      markStarted();
      return new Promise<void>((resolve) => {
        settleOrphan = resolve;
      });
    }, 100);
    await started;
    jest.advanceTimersByTime(100);
    await expect(timedOut).rejects.toBeInstanceOf(DuckDbQueryTimeoutError);
    expect(stuck.interrupt).toHaveBeenCalledTimes(1);

    // Still fail-closed while the interrupt has a chance to be honoured.
    await expect(
      service.withConnection(() => Promise.resolve()),
    ).rejects.toBeInstanceOf(DuckDbUnavailableError);
    expect(instance.closeSync).not.toHaveBeenCalled();

    // Past the grace period the stuck connection is abandoned, not closed
    // (closing mid-statement could block), and the engine is rebuilt without it.
    jest.advanceTimersByTime(5_000);
    expect(stuck.closeSync).not.toHaveBeenCalled();
    expect(instance.closeSync).toHaveBeenCalledTimes(1);
    await expect(
      service.withConnection((leased) => Promise.resolve(leased)),
    ).resolves.toBe(replacement);
    expect(createInstanceMock).toHaveBeenCalledTimes(2);

    // Whatever the orphan does later cannot re-enter the pool.
    settleOrphan();
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    await expect(
      service.withConnection((leased) => Promise.resolve(leased)),
    ).resolves.toBe(replacement);
    expect(createInstanceMock).toHaveBeenCalledTimes(2);

    await service.onModuleDestroy();
    expect(stuck.closeSync).not.toHaveBeenCalled();
    expect(replacement.closeSync).toHaveBeenCalledTimes(1);
  });

  it('does not poison the replacement when an abandoned lease fails its cleanup later', async () => {
    jest.useFakeTimers();
    const stuck = mockConnection();
    const replacement = mockConnection();
    stuck.run.mockImplementation((sql: string) =>
      sql.startsWith('DROP SECRET')
        ? Promise.reject(new Error('secret manager is gone'))
        : Promise.resolve(undefined),
    );
    const instance = mockInstance([stuck]);
    const replacementInstance = mockInstance([replacement]);
    createInstanceMock
      .mockResolvedValueOnce(instance as unknown as DuckDBInstance)
      .mockResolvedValueOnce(replacementInstance as unknown as DuckDBInstance);
    const service = new DuckDbService();
    let markStarted = (): void => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let settleOrphan = (): void => undefined;
    const timedOut = service.withStorageSecret(
      secret('s3://bucket/'),
      () => {
        markStarted();
        return new Promise<void>((resolve) => {
          settleOrphan = resolve;
        });
      },
      100,
    );
    await started;
    jest.advanceTimersByTime(100);
    await expect(timedOut).rejects.toBeInstanceOf(DuckDbQueryTimeoutError);
    jest.advanceTimersByTime(5_000);
    await expect(
      service.withConnection((leased) => Promise.resolve(leased)),
    ).resolves.toBe(replacement);

    // The orphan finally settles and its DROP SECRET fails on the old,
    // already-abandoned instance. That must not condemn the replacement.
    settleOrphan();
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(stuck.run).toHaveBeenCalledWith('DROP SECRET request_secret', []);
    await expect(
      service.withStorageSecret(secret('s3://bucket/'), (leased) =>
        Promise.resolve(leased),
      ),
    ).resolves.toBe(replacement);
    expect(createInstanceMock).toHaveBeenCalledTimes(2);
    expect(replacementInstance.closeSync).not.toHaveBeenCalled();
  });

  it('rejects queued and new acquisitions until poisoned leases drain', async () => {
    const connection = mockConnection();
    const replacement = mockConnection();
    const instance = mockInstance([connection]);
    const replacementInstance = mockInstance([replacement]);
    createInstanceMock
      .mockResolvedValueOnce(instance as unknown as DuckDBInstance)
      .mockResolvedValueOnce(replacementInstance as unknown as DuckDBInstance);
    const service = new DuckDbService();
    let markStarted = (): void => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let finishFirst = (): void => undefined;
    const first = service.withConnection(() => {
      markStarted();
      return new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
    }, 1_000);
    await started;
    const queued = service.withConnection(() => Promise.resolve(), 1_000);
    await Promise.resolve();

    service.invalidate();
    await expect(
      service.withConnection(() => Promise.resolve()),
    ).rejects.toBeInstanceOf(DuckDbUnavailableError);

    finishFirst();
    await first;
    await expect(queued).rejects.toBeInstanceOf(DuckDbUnavailableError);
    await Promise.resolve();
    await expect(
      service.withConnection((leased) => Promise.resolve(leased)),
    ).resolves.toBe(replacement);
  });

  it('rebuilds the instance when a temporary secret cannot be removed', async () => {
    const connection = mockConnection();
    connection.run.mockImplementation((sql) =>
      sql.startsWith('DROP SECRET')
        ? Promise.reject(new Error('drop failed'))
        : Promise.resolve(undefined),
    );
    const replacement = mockConnection();
    const instance = mockInstance([connection]);
    const replacementInstance = mockInstance([replacement]);
    createInstanceMock
      .mockResolvedValueOnce(instance as unknown as DuckDBInstance)
      .mockResolvedValueOnce(replacementInstance as unknown as DuckDBInstance);
    const service = new DuckDbService();
    const requestSecret = secret('s3://fixtures/table');

    await expect(
      service.withStorageSecret(requestSecret, () => Promise.resolve()),
    ).rejects.toThrow('drop failed');
    await expect(
      service.withConnection((leased) => Promise.resolve(leased)),
    ).resolves.toBe(replacement);
    expect(connection.closeSync).toHaveBeenCalledTimes(1);
    expect(instance.closeSync).toHaveBeenCalledTimes(1);
  });

  it('rejects secret-scope waiters when cleanup poisons the instance', async () => {
    const connection = mockConnection();
    let markDropStarted = (): void => undefined;
    const dropStarted = new Promise<void>((resolve) => {
      markDropStarted = resolve;
    });
    let rejectDrop: ((error: Error) => void) | undefined;
    connection.run.mockImplementation((sql) => {
      if (!sql.startsWith('DROP SECRET')) return Promise.resolve(undefined);
      markDropStarted();
      return new Promise((_resolve, reject) => {
        rejectDrop = reject;
      });
    });
    const replacement = mockConnection();
    const instance = mockInstance([connection]);
    const replacementInstance = mockInstance([replacement]);
    createInstanceMock
      .mockResolvedValueOnce(instance as unknown as DuckDBInstance)
      .mockResolvedValueOnce(replacementInstance as unknown as DuckDBInstance);
    const service = new DuckDbService();

    const first = service.withStorageSecret(
      secret('s3://fixtures/table'),
      () => Promise.resolve(),
      1_000,
    );
    await dropStarted;
    const queued = service.withStorageSecret(
      secret('s3://fixtures/table', 'queued'),
      () => Promise.resolve(),
      1_000,
    );
    rejectDrop?.(new Error('drop failed'));

    await expect(first).rejects.toThrow('drop failed');
    await expect(queued).rejects.toBeInstanceOf(DuckDbUnavailableError);
    await expect(
      service.withConnection((leased) => Promise.resolve(leased)),
    ).resolves.toBe(replacement);
  });
});
