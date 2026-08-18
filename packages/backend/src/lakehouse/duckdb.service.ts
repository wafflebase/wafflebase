import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  DuckDBConnection,
  DuckDBInstance,
  DuckDBValue,
} from '@duckdb/node-api';
import {
  LakehouseQueryResponse,
  LakehouseSecretPlan,
  LakehouseSqlStatement,
} from './lakehouse.types';

const REQUIRED_EXTENSIONS = ['httpfs', 'iceberg', 'delta', 'azure'] as const;

/** Wraps a failure inside `hardenInstance` so `initialize` can retry it once. */
class HardeningFailedError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'HardeningFailedError';
    this.cause = cause;
  }
}
const DEFAULT_POOL_SIZE = 2;
const MAX_POOL_SIZE = 8;
const DEFAULT_MAX_PENDING = 64;
const DEFAULT_QUERY_TIMEOUT_MS = 30_000;
/**
 * How long a timed-out operation may keep ignoring its interrupt before its
 * connection is abandoned and the engine rebuilt without it. DuckDB honours
 * interrupts between pipeline tasks, so a well-behaved statement settles well
 * inside this; the grace only exists so that one native operation that never
 * does cannot hold the engine closed until the process restarts.
 */
const INTERRUPT_GRACE_MS = 5_000;

type ConnectionWaiter = {
  resolve: (connection: DuckDBConnection) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class DuckDbPoolExhaustedError extends Error {
  constructor() {
    super('Lakehouse query queue is full');
  }
}

export class DuckDbQueryTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Lakehouse query exceeded the ${timeoutMs}ms timeout`);
  }
}

export class DuckDbUnavailableError extends Error {
  constructor() {
    super('Lakehouse query engine is restarting');
  }
}

function readBoundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    return fallback;
  }
  return parsed;
}

function readMemoryLimit(value: string | undefined): string {
  if (value && /^[1-9][0-9]*(?:KB|MB|GB)$/i.test(value)) {
    return value.toUpperCase();
  }
  return '512MB';
}

function errorFromUnknown(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

@Injectable()
export class DuckDbService implements OnModuleDestroy {
  private readonly logger = new Logger(DuckDbService.name);
  /**
   * Where DuckDB keeps its extension binaries. The production image
   * pre-populates this directory at build time — design §6 asks for exactly
   * that ("locked-down networks must pre-bundle the extensions") — so a
   * deployment with no egress to extensions.duckdb.org still serves lakehouse
   * reads. Unset, as on a developer machine, falls back to `~/.duckdb`.
   */
  private readonly extensionDirectory =
    process.env.LAKEHOUSE_DUCKDB_EXTENSION_DIR?.trim() || undefined;
  private readonly poolSize = readBoundedInteger(
    process.env.LAKEHOUSE_DUCKDB_POOL_SIZE,
    DEFAULT_POOL_SIZE,
    1,
    MAX_POOL_SIZE,
  );
  private readonly maxPending = readBoundedInteger(
    process.env.LAKEHOUSE_DUCKDB_MAX_PENDING,
    DEFAULT_MAX_PENDING,
    1,
    1_000,
  );
  private readonly defaultTimeoutMs = readBoundedInteger(
    process.env.LAKEHOUSE_QUERY_TIMEOUT_MS,
    DEFAULT_QUERY_TIMEOUT_MS,
    100,
    300_000,
  );
  private readonly threads = readBoundedInteger(
    process.env.LAKEHOUSE_DUCKDB_THREADS,
    2,
    1,
    32,
  );
  private readonly memoryLimit = readMemoryLimit(
    process.env.LAKEHOUSE_DUCKDB_MEMORY_LIMIT,
  );

  private instance?: DuckDBInstance;
  private initialization?: Promise<void>;
  private readonly available: DuckDBConnection[] = [];
  private readonly connections = new Set<DuckDBConnection>();
  private readonly leased = new Set<DuckDBConnection>();
  private readonly waiters: ConnectionWaiter[] = [];
  /**
   * DuckDB secrets are instance-global, and table metadata may reference
   * objects outside its configured root. One engine queue prevents a request
   * from resolving a transitive URI with another request's temporary secret.
   */
  private engineTail: Promise<void> = Promise.resolve();
  private enginePending = 0;
  private closing = false;
  private poisoned = false;
  private generation = 0;

  async withConnection<T>(
    operation: (connection: DuckDBConnection) => Promise<T>,
    timeoutMs = this.defaultTimeoutMs,
  ): Promise<T> {
    if (this.poisoned) throw new DuckDbUnavailableError();
    const deadline = Date.now() + timeoutMs;
    return this.withEngineLock(
      () => this.withConnectionUntil(operation, deadline, timeoutMs),
      deadline,
      timeoutMs,
      this.generation,
    );
  }

  /**
   * Owns secret creation and cleanup for every DuckDB consumer. Secrets live
   * at instance scope, so a failed DROP poisons and rebuilds the whole engine.
   */
  async withStorageSecret<T>(
    secret: LakehouseSecretPlan | undefined,
    operation: (connection: DuckDBConnection) => Promise<T>,
    timeoutMs = this.defaultTimeoutMs,
  ): Promise<T> {
    if (this.poisoned) throw new DuckDbUnavailableError();
    if (secret) this.assertSecretScope(secret.scope);
    const deadline = Date.now() + timeoutMs;
    const generation = this.generation;
    const execute = () =>
      this.withConnectionUntil(
        async (connection) => {
          let result: T | undefined;
          let operationError: Error | undefined;
          try {
            if (secret) await this.run(connection, secret.create);
            result = await operation(connection);
          } catch (error) {
            operationError = errorFromUnknown(error, 'Lakehouse query failed');
          }

          let cleanupError: Error | undefined;
          if (secret) {
            try {
              await this.run(connection, secret.cleanup);
            } catch (error) {
              cleanupError = errorFromUnknown(
                error,
                'Failed to remove a temporary DuckDB storage secret',
              );
            }
          }
          // A cleanup failure poisons the instance it happened on. Once the
          // generation has moved on, that instance is already condemned (or,
          // for an abandoned lease, already gone), and the replacement must
          // not be poisoned for a secret it never held.
          if (cleanupError && this.generation === generation) {
            this.logger.error(
              'Failed to clear temporary DuckDB request state; rebuilding DuckDB',
            );
            this.invalidate();
          }
          // Cleanup takes priority because serving another request from an
          // instance that may retain credentials or access is never safe.
          if (cleanupError) throw cleanupError;
          if (operationError) throw operationError;
          return result as T;
        },
        deadline,
        timeoutMs,
      );

    return this.withEngineLock(execute, deadline, timeoutMs, generation);
  }

  /**
   * Marks the current in-process database unsafe. Existing leases are allowed
   * to settle, while queued/new work fails closed until the instance is gone.
   */
  invalidate(): void {
    if (this.closing || this.poisoned) return;
    this.poisoned = true;
    this.generation += 1;
    this.rejectWaiters(new DuckDbUnavailableError());
    this.available.length = 0;
    if (this.leased.size === 0) this.resetPoisonedInstance();
  }

  async run(
    connection: DuckDBConnection,
    statement: LakehouseSqlStatement,
  ): Promise<void> {
    await connection.run(statement.sql, [...statement.values] as DuckDBValue[]);
  }

  async query(
    connection: DuckDBConnection,
    statement: LakehouseSqlStatement,
    maxRows: number,
  ): Promise<LakehouseQueryResponse> {
    const startedAt = Date.now();
    const reader = await connection.runAndReadAll(statement.sql, [
      ...statement.values,
    ] as DuckDBValue[]);
    const executionTime = Date.now() - startedAt;
    const allRows = reader.getRowObjectsJson();
    const truncated = allRows.length > maxRows;
    const rows = truncated ? allRows.slice(0, maxRows) : allRows;
    const types = reader.columnTypes();

    return {
      columns: reader.columnNames().map((name, index) => ({
        name,
        dataTypeID: types[index].typeId,
      })),
      rows,
      rowCount: rows.length,
      truncated,
      executionTime,
    };
  }

  async queryRows(
    connection: DuckDBConnection,
    statement: LakehouseSqlStatement,
  ): Promise<Array<Record<string, unknown>>> {
    const reader = await connection.runAndReadAll(statement.sql, [
      ...statement.values,
    ] as DuckDBValue[]);
    return reader.getRowObjectsJson();
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    this.rejectWaiters(new Error('DuckDB service is shutting down'));
    await this.initialization?.catch(() => undefined);
    this.closeCurrentInstance();
    this.leased.clear();
  }

  private async withConnectionUntil<T>(
    operation: (connection: DuckDBConnection) => Promise<T>,
    deadline: number,
    timeoutMs: number,
  ): Promise<T> {
    const connection = await this.acquire(deadline, timeoutMs);
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      this.finishLease(connection);
      throw new DuckDbQueryTimeoutError(timeoutMs);
    }

    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const operationPromise = Promise.resolve().then(() =>
      operation(connection),
    );
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          connection.interrupt();
        } catch {
          // Preserve the stable timeout error if interrupt races with close.
        }
        this.invalidate();
        reject(new DuckDbQueryTimeoutError(timeoutMs));
      }, remainingMs);
    });

    try {
      return await Promise.race([operationPromise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        this.releaseWhenSettled(connection, operationPromise);
      } else {
        this.finishLease(connection);
      }
    }
  }

  /**
   * A timed-out lease is normally returned when its interrupted operation
   * settles, and that return is what tears the poisoned instance down. An
   * operation that ignores the interrupt would otherwise hold the lease
   * forever and keep every later request failing closed, so after a grace
   * period the connection is abandoned instead: it leaves the pool without
   * being closed (closing a connection mid-statement can block the event
   * loop), the rest of the poisoned instance is rebuilt, and whatever the
   * orphan does later cannot reach the replacement because `finishLease` no
   * longer recognizes it. The credential invariant holds either way: the
   * replacement instance never held the orphan's secret.
   */
  private releaseWhenSettled(
    connection: DuckDBConnection,
    operationPromise: Promise<unknown>,
  ): void {
    const grace = setTimeout(() => {
      if (this.closing || !this.leased.delete(connection)) return;
      this.connections.delete(connection);
      this.logger.warn(
        `DuckDB ignored an interrupt for ${INTERRUPT_GRACE_MS}ms; abandoning its connection and rebuilding DuckDB`,
      );
      if (this.poisoned && this.leased.size === 0) {
        this.resetPoisonedInstance();
      }
    }, INTERRUPT_GRACE_MS);
    const settle = (): void => {
      clearTimeout(grace);
      this.finishLease(connection);
    };
    void operationPromise.then(settle, settle);
  }

  private async acquire(
    deadline: number,
    timeoutMs: number,
  ): Promise<DuckDBConnection> {
    if (this.closing) throw new Error('DuckDB service is shutting down');
    if (this.poisoned) throw new DuckDbUnavailableError();
    await this.waitForInitialization(deadline, timeoutMs);
    if (this.closing) throw new Error('DuckDB service is shutting down');
    if (this.poisoned) throw new DuckDbUnavailableError();

    const available = this.available.pop();
    if (available) {
      this.leased.add(available);
      return available;
    }
    if (this.waiters.length >= this.maxPending) {
      throw new DuckDbPoolExhaustedError();
    }

    return new Promise<DuckDBConnection>((resolve, reject) => {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        reject(new DuckDbQueryTimeoutError(timeoutMs));
        return;
      }
      const waiter: ConnectionWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new DuckDbQueryTimeoutError(timeoutMs));
        }, remainingMs),
      };
      this.waiters.push(waiter);
    });
  }

  private finishLease(connection: DuckDBConnection): void {
    if (!this.leased.delete(connection)) return;
    if (this.closing) return;
    if (this.poisoned) {
      if (this.leased.size === 0) this.resetPoisonedInstance();
      return;
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      this.leased.add(connection);
      waiter.resolve(connection);
      return;
    }
    this.available.push(connection);
  }

  private rejectWaiters(error: Error): void {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  private async waitForInitialization(
    deadline: number,
    timeoutMs: number,
  ): Promise<void> {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new DuckDbQueryTimeoutError(timeoutMs);

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.ensureInitialized(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new DuckDbQueryTimeoutError(timeoutMs)),
            remainingMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async withEngineLock<T>(
    operation: () => Promise<T>,
    deadline: number,
    timeoutMs: number,
    generation: number,
  ): Promise<T> {
    if (this.enginePending >= this.maxPending + 1) {
      throw new DuckDbPoolExhaustedError();
    }
    this.enginePending += 1;

    const predecessor = this.engineTail.catch(() => undefined);
    let release = (): void => undefined;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const tail = predecessor.then(() => gate);
    this.engineTail = tail;

    try {
      await this.waitBefore(predecessor, deadline, timeoutMs);
      if (this.poisoned || generation !== this.generation) {
        throw new DuckDbUnavailableError();
      }
      return await operation();
    } finally {
      release();
      this.enginePending -= 1;
    }
  }

  private assertSecretScope(scope: string): void {
    if (!scope) throw new Error('DuckDB secret scope must not be empty');
    const separator = scope.includes('://')
      ? '/'
      : process.platform === 'win32'
        ? '\\'
        : '/';
    if (!scope.endsWith(separator)) {
      throw new Error('DuckDB secret scope must end with a separator');
    }
  }

  private async waitBefore(
    predecessor: Promise<void>,
    deadline: number,
    timeoutMs: number,
  ): Promise<void> {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new DuckDbQueryTimeoutError(timeoutMs);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        predecessor,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new DuckDbQueryTimeoutError(timeoutMs)),
            remainingMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async ensureInitialized(): Promise<void> {
    this.initialization ??= this.initialize().catch((error: unknown) => {
      this.initialization = undefined;
      throw error;
    });
    await this.initialization;
  }

  private async initialize(): Promise<void> {
    try {
      await this.buildInstance();
    } catch (error) {
      if (!(error instanceof HardeningFailedError)) throw error;
      // Seen on every fresh container: right after the extensions are
      // downloaded for the first time, the first `SET allow_persistent_secrets`
      // in the process fails with "Changing Secret Manager settings after the
      // secret manager is used is not allowed!" — and the very next instance
      // accepts it. Without this retry the first lakehouse request of every
      // new container fails once (initialization is retried lazily on the
      // next request, when the extensions are already on disk). Hardening is
      // deterministic, so a second failure is a real problem and propagates.
      this.logger.warn(
        `DuckDB hardening failed on a fresh instance; rebuilding once: ${error.message}`,
      );
      await this.buildInstance();
    }
  }

  private async buildInstance(): Promise<void> {
    if (this.closing) throw new Error('DuckDB service is shutting down');

    const instance = await DuckDBInstance.create(':memory:', {
      threads: String(this.threads),
      memory_limit: this.memoryLimit,
      ...(this.extensionDirectory && {
        extension_directory: this.extensionDirectory,
      }),
    });
    const createdConnections: DuckDBConnection[] = [];

    try {
      const bootstrap = await instance.connect();
      createdConnections.push(bootstrap);
      await this.loadExtensions(bootstrap);

      for (let index = 1; index < this.poolSize; index += 1) {
        const connection = await instance.connect();
        createdConnections.push(connection);
        await this.loadExtensions(connection);
      }
      try {
        await this.hardenInstance(bootstrap);
      } catch (error) {
        throw new HardeningFailedError(error);
      }

      if (this.closing) {
        throw new Error('DuckDB service is shutting down');
      }
      this.instance = instance;
      for (const connection of createdConnections) {
        this.connections.add(connection);
        this.available.push(connection);
      }
    } catch (error) {
      for (const connection of createdConnections) {
        try {
          connection.closeSync();
        } catch {
          // Preserve the initialization error.
        }
      }
      try {
        instance.closeSync();
      } catch {
        // Preserve the initialization error.
      }
      throw error;
    }
  }

  /**
   * LOAD first, INSTALL only if that fails.
   *
   * A pre-bundled image therefore never reaches the network: the binaries are
   * already in `extension_directory`, and INSTALL would be a pointless round
   * trip to extensions.duckdb.org that a locked-down deployment cannot make.
   * An empty directory — a developer machine, or an image built without the
   * bundling step — fails the LOAD and self-heals by downloading once.
   */
  private async loadExtensions(connection: DuckDBConnection): Promise<void> {
    for (const extension of REQUIRED_EXTENSIONS) {
      try {
        await connection.run(`LOAD ${extension}`);
      } catch {
        await connection.run(`INSTALL ${extension}`);
        await connection.run(`LOAD ${extension}`);
      }
    }
  }

  private async hardenInstance(connection: DuckDBConnection): Promise<void> {
    const statements = [
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
    ];
    for (const sql of statements) {
      await connection.run(sql);
    }
  }

  private resetPoisonedInstance(): void {
    this.closeCurrentInstance();
    this.initialization = undefined;
    this.poisoned = false;
  }

  private closeCurrentInstance(): void {
    for (const connection of this.connections) {
      try {
        connection.interrupt();
      } catch {
        // A connection may already be closed or idle.
      }
      try {
        connection.closeSync();
      } catch {
        // Preserve the original failure that invalidated the instance.
      }
    }
    this.connections.clear();
    this.available.length = 0;

    try {
      this.instance?.closeSync();
    } catch {
      // Preserve the original failure that invalidated the instance.
    }
    this.instance = undefined;
  }
}
