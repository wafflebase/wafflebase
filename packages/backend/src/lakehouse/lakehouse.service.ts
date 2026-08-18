import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  RequestTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { LakehouseSource, Prisma } from '@prisma/client';
import { DuckDBConnection } from '@duckdb/node-api';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaService } from 'src/database/prisma.service';
import { decrypt, encrypt } from 'src/datasource/crypto.util';
import {
  DuckDbPoolExhaustedError,
  DuckDbQueryTimeoutError,
  DuckDbService,
  DuckDbUnavailableError,
} from './duckdb.service';
import {
  CatalogTableRefDto,
  CreateLakehouseSourceDto,
  LakehouseCatalogMode,
  LakehouseCredentialsDto,
  LakehouseFormat,
  LakehouseStorage,
  ReadLakehouseDto,
  TimeTravelPointDto,
  UpdateLakehouseSourceDto,
} from './lakehouse.dto';
import {
  AttachableCatalogMode,
  planCatalogAttach,
  planCatalogRead,
  planCatalogTables,
} from './lakehouse-catalog-plan';
import {
  planLakehouseHistory,
  planLakehouseRead,
} from './lakehouse-query-plan';
import { planStorageSecret } from './lakehouse-secret-plan';
import {
  LakehouseCatalogTable,
  LakehouseHistoryEntry,
  LakehouseQueryResponse,
  LakehouseStorageCredentials,
  LakehouseTableRef,
  LakehouseTimeTravel,
} from './lakehouse.types';

const MASKED_CREDENTIALS = '********';
const MAX_ROWS = 10_000;
const MAX_HISTORY_ENTRIES = 1_000;

type SourceConfiguration = {
  format: string;
  storage: string;
  endpoint?: string | null;
  region?: string | null;
  bucket?: string | null;
  basePath: string | null;
  catalogMode?: LakehouseCatalogMode | null;
  catalogUri?: string | null;
};

type ExecutionConfiguration = {
  ref: LakehouseTableRef;
  credentials: LakehouseStorageCredentials;
};

function errorFromUnknown(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

/** Catalog listings are VARCHAR columns; anything else is not a name. */
function textValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

@Injectable()
export class LakehouseService {
  private readonly logger = new Logger(LakehouseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly duckDb: DuckDbService,
  ) {}

  async create(
    userId: number,
    workspaceId: string,
    dto: CreateLakehouseSourceDto,
  ) {
    const catalogMode = this.assertCatalogMode(
      dto.catalogMode ?? 'direct_metadata',
    );
    const credentials = this.normalizeCredentials(dto.storage, dto.credentials);
    const connectionFields = this.normalizeConnectionFields(dto.storage, dto);
    const configuration = {
      ...dto,
      ...connectionFields,
      basePath: dto.basePath ?? null,
      catalogMode,
      catalogUri: dto.catalogUri ?? null,
    };
    this.validateConfiguration(configuration, credentials);

    try {
      const source = await this.prisma.lakehouseSource.create({
        data: {
          name: dto.name.trim(),
          format: dto.format,
          storage: dto.storage,
          endpoint: connectionFields.endpoint,
          region: connectionFields.region,
          bucket: connectionFields.bucket,
          basePath: dto.basePath?.trim() ?? null,
          catalogMode,
          catalogUri: dto.catalogUri?.trim() ?? null,
          credentials: encrypt(JSON.stringify(credentials)),
          authorID: userId,
          workspaceId,
        },
      });
      return this.mask(source);
    } catch (error) {
      this.rethrowPersistenceError(error);
    }
  }

  async findAllByWorkspace(workspaceId: string) {
    const sources = await this.prisma.lakehouseSource.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
    return sources.map((source) => this.mask(source));
  }

  async findOne(id: string) {
    return this.mask(await this.findRaw(id));
  }

  async findRaw(id: string): Promise<LakehouseSource> {
    const source = await this.prisma.lakehouseSource.findUnique({
      where: { id },
    });
    if (!source) throw new NotFoundException('Lakehouse source not found');
    return source;
  }

  async update(id: string, dto: UpdateLakehouseSourceDto) {
    const existing = await this.findRaw(id);
    const {
      source: merged,
      credentials,
      storageChanged,
      targetChanged,
      credentialsChanged,
    } = this.updatedConfiguration(existing, dto);
    this.validateConfiguration(merged, credentials);

    try {
      const result = await this.prisma.lakehouseSource.updateMany({
        // Compare every security-relevant field read above. PostgreSQL
        // re-checks this predicate after a concurrent row update, so stale
        // credential merges cannot retarget hidden credentials.
        where: {
          id,
          format: existing.format,
          storage: existing.storage,
          endpoint: existing.endpoint,
          region: existing.region,
          bucket: existing.bucket,
          basePath: existing.basePath,
          catalogMode: existing.catalogMode,
          catalogUri: existing.catalogUri,
          credentials: existing.credentials,
          updatedAt: existing.updatedAt,
        },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.format !== undefined && { format: merged.format }),
          ...(dto.storage !== undefined && { storage: merged.storage }),
          ...((dto.endpoint !== undefined || storageChanged) && {
            endpoint: merged.endpoint,
          }),
          ...((dto.region !== undefined || storageChanged) && {
            region: merged.region,
          }),
          ...((dto.bucket !== undefined || storageChanged) && {
            bucket: merged.bucket,
          }),
          ...(dto.basePath !== undefined && {
            basePath: merged.basePath?.trim() ?? null,
          }),
          ...(dto.catalogMode !== undefined && {
            catalogMode: this.assertCatalogMode(merged.catalogMode),
          }),
          ...(dto.catalogUri !== undefined && {
            catalogUri: merged.catalogUri?.trim() ?? null,
          }),
          ...((credentialsChanged || targetChanged) && {
            credentials: encrypt(JSON.stringify(credentials)),
          }),
        },
      });
      if (result.count !== 1) {
        throw new ConflictException(
          'Lakehouse source changed while it was being updated; retry with the latest values',
        );
      }
      return this.mask(await this.findRaw(id));
    } catch (error) {
      this.rethrowPersistenceError(error);
    }
  }

  async remove(id: string) {
    await this.findRaw(id);
    const source = await this.prisma.lakehouseSource.delete({ where: { id } });
    return this.mask(source);
  }

  async testConnection(id: string, dto: UpdateLakehouseSourceDto = {}) {
    const source = await this.findRaw(id);
    const candidate = this.updatedConfiguration(source, dto);
    return this.runConnectionTest(candidate.source, candidate.credentials);
  }

  async testConfiguration(dto: CreateLakehouseSourceDto) {
    const credentials = this.normalizeCredentials(dto.storage, dto.credentials);
    const source: SourceConfiguration = {
      ...dto,
      basePath: dto.basePath ?? null,
      catalogMode: dto.catalogMode ?? 'direct_metadata',
      catalogUri: dto.catalogUri ?? null,
    };
    return this.runConnectionTest(source, credentials);
  }

  private async runConnectionTest(
    source: SourceConfiguration,
    credentials: LakehouseCredentialsDto,
  ) {
    // Malformed configurations reject with 400 BEFORE any engine work; only
    // reachability problems downgrade to a { success: false } test result.
    this.validateConfiguration(source, credentials);
    try {
      if (this.catalogModeOf(source) === 'direct_metadata') {
        const execution = this.executionConfiguration(source, credentials);
        await this.executeRead(execution, undefined, 1);
      } else {
        // A catalog connection is proven by attaching and listing tables.
        await this.executeCatalogTables(source, credentials);
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: this.connectionTestError(error),
      };
    }
  }

  async read(id: string, dto: ReadLakehouseDto) {
    const source = await this.findRaw(id);
    const credentials = this.decryptCredentials(source);

    if (this.catalogModeOf(source) !== 'direct_metadata') {
      if (!dto.table) {
        throw new BadRequestException(
          'Catalog-mode reads require a { namespace, table } reference',
        );
      }
      if (dto.asOf) {
        // The direct-metadata scan functions carry the engine's time-travel
        // arguments; attached catalog tables have no verified equivalent yet.
        throw new BadRequestException(
          'Time travel is only available for direct-metadata sources',
        );
      }
      try {
        return await this.executeCatalogRead(source, credentials, dto.table);
      } catch (error) {
        this.rethrowQueryError(error);
      }
    }

    // A direct-metadata source reads exactly the table its `basePath` names,
    // so a `table` reference is not a narrowing we can honour. Ignoring it
    // would answer with one table's rows under another table's name — e.g.
    // when a client mixes up a catalog source id with a direct-metadata one.
    if (dto.table) {
      throw new BadRequestException(
        'A table reference is only accepted by catalog-mode sources',
      );
    }

    const execution = this.executionConfiguration(source, credentials);
    const asOf = await this.resolveTimeTravelPoint(
      source.format,
      dto.asOf,
      execution,
    );

    try {
      return await this.executeRead(execution, asOf, MAX_ROWS);
    } catch (error) {
      this.rethrowQueryError(error);
    }
  }

  async history(
    id: string,
    limit = MAX_HISTORY_ENTRIES,
  ): Promise<LakehouseHistoryEntry[]> {
    const source = await this.findRaw(id);
    if (this.catalogModeOf(source) !== 'direct_metadata') {
      throw new BadRequestException(
        'Commit history is only available for direct-metadata sources',
      );
    }
    const execution = this.executionConfiguration(
      source,
      this.decryptCredentials(source),
    );
    const boundedLimit = Math.min(limit, MAX_HISTORY_ENTRIES);

    try {
      return await this.historyEntries(source.format, execution, boundedLimit);
    } catch (error) {
      this.rethrowQueryError(error);
    }
  }

  /** GET /lakehouse-sources/:id/tables — lists tables of a catalog source. */
  async tables(id: string): Promise<LakehouseCatalogTable[]> {
    const source = await this.findRaw(id);
    if (this.catalogModeOf(source) === 'direct_metadata') {
      throw new BadRequestException(
        'Table listing is only available for catalog-mode sources',
      );
    }
    try {
      return await this.executeCatalogTables(
        source,
        this.decryptCredentials(source),
      );
    } catch (error) {
      this.rethrowQueryError(error);
    }
  }

  private async historyEntries(
    format: string,
    execution: ExecutionConfiguration,
    limit: number,
  ): Promise<LakehouseHistoryEntry[]> {
    const rows = await this.withStorageSecret(execution, (connection) =>
      this.duckDb.queryRows(
        connection,
        planLakehouseHistory(execution.ref, limit),
      ),
    );
    return this.mapHistory(format, rows).reverse();
  }

  private async executeRead(
    execution: ExecutionConfiguration,
    asOf: LakehouseTimeTravel | undefined,
    maxRows: number,
  ) {
    const alias = `lakehouse_${randomUUID().replaceAll('-', '')}`;
    const plan = planLakehouseRead(execution.ref, asOf, maxRows + 1, alias);

    return this.withStorageSecret(execution, async (connection) => {
      let setupComplete = false;
      let result: LakehouseQueryResponse | undefined;
      let operationError: Error | undefined;
      try {
        for (const statement of plan.setup) {
          await this.duckDb.run(connection, statement);
        }
        setupComplete = true;
        result = await this.duckDb.query(connection, plan.read, maxRows);
      } catch (error) {
        operationError = errorFromUnknown(error, 'Lakehouse read failed');
      }

      let cleanupError: Error | undefined;
      if (setupComplete) {
        for (const statement of [...plan.cleanup].reverse()) {
          try {
            await this.duckDb.run(connection, statement);
          } catch (error) {
            cleanupError ??= errorFromUnknown(
              error,
              'Failed to detach a temporary Delta table',
            );
            this.logger.error(
              'Failed to detach a temporary Delta table after a query',
            );
            this.duckDb.invalidate();
          }
        }
      }

      // A failed DETACH leaves connection-local state behind. Poisoning the
      // shared instance is conservative, rare, and prevents cross-request use.
      if (cleanupError) throw cleanupError;
      if (operationError) throw operationError;
      if (!result) throw new Error('Lakehouse query returned no result');
      return result;
    });
  }

  private async withStorageSecret<T>(
    execution: ExecutionConfiguration,
    operation: (connection: DuckDBConnection) => Promise<T>,
  ): Promise<T> {
    const secretName = `lakehouse_${randomUUID().replaceAll('-', '')}`;
    const secret = planStorageSecret(secretName, execution.credentials);
    return this.duckDb.withStorageSecret<T>(secret, operation);
  }

  private async executeCatalogRead(
    source: SourceConfiguration,
    rawCredentials: LakehouseCredentialsDto,
    table: CatalogTableRefDto,
  ): Promise<LakehouseQueryResponse> {
    return this.withCatalogAttached(
      source,
      rawCredentials,
      async (connection, alias) => {
        const plan = planCatalogRead(alias, table, MAX_ROWS + 1);
        return this.duckDb.query(connection, plan.read, MAX_ROWS);
      },
    );
  }

  private async executeCatalogTables(
    source: SourceConfiguration,
    rawCredentials: LakehouseCredentialsDto,
  ): Promise<LakehouseCatalogTable[]> {
    return this.withCatalogAttached(
      source,
      rawCredentials,
      async (connection, alias) => {
        const rows = await this.duckDb.queryRows(
          connection,
          planCatalogTables(alias),
        );
        return rows.map((row) => ({
          // Nested Iceberg namespaces surface as dot-joined schema names.
          namespace: textValue(row.schema).split('.'),
          table: textValue(row.name),
        }));
      },
    );
  }

  /**
   * Attaches the source's Iceberg catalog for the duration of `operation`.
   * The storage secret covers the data files the catalog resolves to (scoped
   * to the configured bucket root); a REST bearer token, when present, is
   * minted as a separate instance-scoped iceberg secret. DETACH and secret
   * cleanup always run so no request leaves state on the shared instance.
   */
  private async withCatalogAttached<T>(
    source: SourceConfiguration,
    rawCredentials: LakehouseCredentialsDto,
    operation: (connection: DuckDBConnection, alias: string) => Promise<T>,
  ): Promise<T> {
    const configuration = this.catalogConfiguration(source, rawCredentials);
    const alias = `lakehouse_${randomUUID().replaceAll('-', '')}`;
    const catalogSecretName = `${alias}_catalog`;
    const attach = planCatalogAttach(
      alias,
      catalogSecretName,
      configuration.mode,
      configuration.catalogUri,
      configuration.warehouse,
      configuration.catalogToken,
    );

    return this.withStorageSecret(
      { ref: configuration.ref, credentials: configuration.credentials },
      async (connection) => {
        let attached = false;
        let secretCreated = false;
        let result: T | undefined;
        let operationError: Error | undefined;
        try {
          if (attach.secret) {
            await this.duckDb.run(connection, attach.secret.create);
            secretCreated = true;
          }
          await this.duckDb.run(connection, attach.attach);
          attached = true;
          result = await operation(connection, alias);
        } catch (error) {
          operationError = errorFromUnknown(error, 'Lakehouse catalog failed');
        }

        let cleanupError: Error | undefined;
        if (attached) {
          try {
            await this.duckDb.run(connection, attach.detach);
          } catch (error) {
            cleanupError = errorFromUnknown(
              error,
              'Failed to detach a lakehouse catalog',
            );
            this.logger.error('Failed to detach a lakehouse catalog');
            this.duckDb.invalidate();
          }
        }
        if (secretCreated && attach.secret) {
          try {
            await this.duckDb.run(connection, attach.secret.cleanup);
          } catch (error) {
            cleanupError ??= errorFromUnknown(
              error,
              'Failed to drop a catalog secret',
            );
            this.logger.error('Failed to drop a catalog secret');
            this.duckDb.invalidate();
          }
        }

        if (cleanupError) throw cleanupError;
        if (operationError) throw operationError;
        if (result === undefined) {
          throw new Error('Lakehouse catalog operation returned no result');
        }
        return result;
      },
    );
  }

  /** Validates and assembles everything a catalog attach needs. */
  private catalogConfiguration(
    source: SourceConfiguration,
    rawCredentials: LakehouseCredentialsDto,
  ): {
    mode: AttachableCatalogMode;
    catalogUri: string;
    warehouse: string;
    ref: LakehouseTableRef;
    credentials: LakehouseStorageCredentials;
    catalogToken?: string;
  } {
    try {
      const mode = this.assertCatalogMode(this.catalogModeOf(source));
      if (mode === 'direct_metadata') {
        throw new Error('Catalog configuration requires a catalog mode');
      }
      if (mode === 'unity') {
        // The schema reserves `unity` (design doc §2), but no attach path is
        // specified for it, so reject until one is designed.
        throw new Error('The unity catalog mode is not supported yet');
      }
      const format = this.assertFormat(source.format);
      if (format !== 'iceberg') {
        throw new Error('Catalog mode requires the iceberg format');
      }
      const storage = this.assertStorage(source.storage);
      if (storage === 'local') {
        throw new Error('Catalog mode requires object storage');
      }
      const catalogUri = source.catalogUri?.trim();
      if (!catalogUri) {
        throw new Error(`${mode} sources require catalogUri`);
      }
      if (mode === 'rest_catalog') {
        this.assertEndpointAllowed(
          new URL(catalogUri).origin,
          'rest_catalog catalogUri origin',
        );
      } else if (storage !== 's3') {
        throw new Error('s3_tables sources require the s3 storage kind');
      }
      // The catalog resolves table locations itself; the storage secret is
      // scoped to the configured bucket root, so vended locations outside it
      // fail credential lookup instead of silently using our credentials.
      if (!source.bucket) {
        throw new Error('Catalog mode requires bucket for credential scoping');
      }
      const scheme =
        storage === 'azure' ? 'az' : storage === 'gcs' ? 'gcs' : 's3';
      const scopePath = `${scheme}://${source.bucket}/`;
      const normalizedCredentials = this.normalizeCredentials(
        storage,
        rawCredentials,
      );
      const credentials = this.storageCredentials(
        { ...source, format, storage },
        scopePath,
        normalizedCredentials,
      );
      const ref: LakehouseTableRef = { format, storage, path: scopePath };
      planStorageSecret('lakehouse_validation', credentials);
      const warehouse = source.basePath?.trim() || 'default';
      planCatalogAttach(
        'lakehouse_validation',
        'lakehouse_validation_secret',
        mode,
        catalogUri,
        warehouse,
        normalizedCredentials.catalogToken,
      );
      return {
        mode,
        catalogUri,
        warehouse,
        ref,
        credentials,
        ...(normalizedCredentials.catalogToken && {
          catalogToken: normalizedCredentials.catalogToken,
        }),
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(
        errorFromUnknown(error, 'Invalid lakehouse catalog source').message,
      );
    }
  }

  /** Full-source validation used by create/update/test paths. */
  private validateConfiguration(
    source: SourceConfiguration,
    credentials: LakehouseCredentialsDto,
  ): void {
    if (this.catalogModeOf(source) === 'direct_metadata') {
      this.executionConfiguration(source, credentials);
    } else {
      this.catalogConfiguration(source, credentials);
    }
  }

  private catalogModeOf(source: {
    catalogMode?: string | null;
  }): LakehouseCatalogMode {
    return this.assertCatalogMode(source.catalogMode ?? 'direct_metadata');
  }

  private assertCatalogMode(
    mode: string | null | undefined,
  ): LakehouseCatalogMode {
    if (
      mode === 'direct_metadata' ||
      mode === 'rest_catalog' ||
      mode === 's3_tables' ||
      mode === 'unity'
    ) {
      return mode;
    }
    throw new BadRequestException(`Unsupported catalog mode: ${String(mode)}`);
  }

  private executionConfiguration(
    source: SourceConfiguration,
    rawCredentials: LakehouseCredentialsDto,
  ): ExecutionConfiguration {
    try {
      const format = this.assertFormat(source.format);
      const storage = this.assertStorage(source.storage);
      const path = this.tablePath({ ...source, format, storage });
      this.assertDirectMetadataPath(format, path);
      const normalizedCredentials = this.normalizeCredentials(
        storage,
        rawCredentials,
      );
      const credentials = this.storageCredentials(
        { ...source, format, storage },
        path,
        normalizedCredentials,
      );

      const ref = { format, storage, path };
      planStorageSecret('lakehouse_validation', credentials);
      planLakehouseRead(ref, undefined, 1);
      return { ref, credentials };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(
        errorFromUnknown(error, 'Invalid lakehouse source').message,
      );
    }
  }

  private tablePath(
    source: SourceConfiguration & {
      format: LakehouseFormat;
      storage: LakehouseStorage;
    },
  ): string {
    const basePath = source.basePath?.trim();
    if (!basePath) {
      throw new BadRequestException('Direct-metadata sources require basePath');
    }
    if (source.storage === 'local') {
      return this.authorizedLocalPath(basePath);
    }

    const scheme =
      source.storage === 'azure'
        ? 'az'
        : source.storage === 'gcs'
          ? 'gcs'
          : 's3';
    if (!source.bucket) return basePath;
    if (basePath.includes('://')) {
      throw new BadRequestException(
        'basePath must be relative when bucket is provided',
      );
    }
    return `${scheme}://${source.bucket}/${basePath.replace(/^\/+/, '')}`;
  }

  private storageCredentials(
    source: SourceConfiguration & {
      format: LakehouseFormat;
      storage: LakehouseStorage;
    },
    path: string,
    credentials: LakehouseCredentialsDto,
  ): LakehouseStorageCredentials {
    const scope = this.storageScope(path, source.format, source.storage);
    if (source.storage === 'local') return { kind: 'local', scope };
    const accessKeyId = credentials.accessKeyId?.trim();
    const secretAccessKey = credentials.secretAccessKey;

    if (source.storage === 's3' || source.storage === 'gcs') {
      if (!accessKeyId || !secretAccessKey) {
        throw new BadRequestException(
          `${source.storage} requires accessKeyId and secretAccessKey`,
        );
      }
      if (source.storage === 'gcs') {
        if (source.endpoint) {
          const endpoint = this.s3CompatibleEndpoint(source.endpoint);
          return {
            kind: 'gcs',
            accessKeyId,
            secretAccessKey,
            endpoint: endpoint.host,
            useSsl: endpoint.useSsl,
            scope,
          };
        }
        return {
          kind: 'gcs',
          accessKeyId,
          secretAccessKey,
          scope,
        };
      }
      return {
        kind: 's3',
        accessKeyId,
        secretAccessKey,
        region: source.region?.trim() || 'us-east-1',
        scope,
        ...(credentials.sessionToken && {
          sessionToken: credentials.sessionToken,
        }),
      };
    }

    if (source.storage === 's3-compatible') {
      if (!accessKeyId || !secretAccessKey) {
        throw new BadRequestException(
          's3-compatible requires accessKeyId and secretAccessKey',
        );
      }
      const endpoint = this.s3CompatibleEndpoint(source.endpoint);
      return {
        kind: 's3-compatible',
        accessKeyId,
        secretAccessKey,
        endpoint: endpoint.host,
        useSsl: endpoint.useSsl,
        region: source.region?.trim() || 'us-east-1',
        scope,
        ...(credentials.sessionToken && {
          sessionToken: credentials.sessionToken,
        }),
      };
    }

    const connectionString = credentials.connectionString
      ? this.validateAzureConnectionString(credentials.connectionString)
      : this.azureConnectionString(source, credentials);
    return {
      kind: 'azure',
      connectionString,
      scope,
    };
  }

  private storageScope(
    path: string,
    format: LakehouseFormat,
    storage: LakehouseStorage,
  ): string {
    if (storage === 'local') {
      const root =
        format === 'delta'
          ? path
          : path.includes(`${sep}metadata${sep}`)
            ? path.slice(0, path.lastIndexOf(`${sep}metadata${sep}`))
            : dirname(path);
      return root.endsWith(sep) ? root : `${root}${sep}`;
    }

    const uri = new URL(path);
    if (uri.port) {
      throw new BadRequestException(
        'Object-storage table paths cannot contain a port',
      );
    }
    // Derived from the RAW path, never from `uri.pathname`: DuckDB matches a
    // secret's SCOPE as a plain prefix of the URI it is handed, and the URI
    // handed to iceberg_scan/delta_scan is this same raw string. Going
    // through `pathname` percent-encodes spaces and non-ASCII, so the prefix
    // would not match and the read would run unscoped — a 403 from the store
    // rather than a leak, but the connector would be silently broken for any
    // table path containing a space or a non-ASCII character.
    const authorityStart = path.indexOf('://') + 3;
    const pathStart = path.indexOf('/', authorityStart);
    const prefix = pathStart === -1 ? path : path.slice(0, pathStart);
    let rootPath = (pathStart === -1 ? '' : path.slice(pathStart)).replace(
      /\/+$/,
      '',
    );
    if (format === 'iceberg') {
      const metadataDirectory = rootPath.lastIndexOf('/metadata/');
      const lastSlash = rootPath.lastIndexOf('/');
      rootPath =
        metadataDirectory >= 0
          ? rootPath.slice(0, metadataDirectory)
          : rootPath.slice(0, Math.max(lastSlash, 0));
    }
    const root = `${prefix}${rootPath}`;
    return root.endsWith('/') ? root : `${root}/`;
  }

  private s3CompatibleEndpoint(endpoint: string | null | undefined): {
    host: string;
    useSsl: boolean;
  } {
    if (!endpoint) {
      throw new BadRequestException(
        's3-compatible storage requires an endpoint',
      );
    }
    let uri: URL;
    try {
      uri = new URL(endpoint);
    } catch {
      throw new BadRequestException(
        's3-compatible endpoint must include http:// or https://',
      );
    }
    if (
      !['http:', 'https:'].includes(uri.protocol) ||
      uri.username ||
      uri.password ||
      (uri.pathname !== '' && uri.pathname !== '/') ||
      uri.search ||
      uri.hash
    ) {
      throw new BadRequestException(
        's3-compatible endpoint must be an HTTP(S) origin without credentials or a path',
      );
    }
    const normalized = uri.toString().replace(/\/$/, '');
    this.assertEndpointAllowed(normalized, 's3-compatible endpoint');
    return { host: uri.host, useSsl: uri.protocol === 'https:' };
  }

  private azureConnectionString(
    source: SourceConfiguration,
    credentials: LakehouseCredentialsDto,
  ): string {
    const accountName = credentials.accountName?.trim();
    const accountKey = credentials.accountKey;
    const sasToken = credentials.sasToken?.replace(/^\?/, '');
    if (!accountName || (!accountKey && !sasToken)) {
      throw new BadRequestException(
        'Azure requires connectionString or accountName with accountKey or sasToken',
      );
    }
    if (accountKey && sasToken) {
      throw new BadRequestException(
        'Azure accountKey and sasToken are mutually exclusive',
      );
    }
    if (!/^[a-zA-Z0-9]+$/.test(accountName)) {
      throw new BadRequestException(
        'Azure accountName must contain only letters and digits',
      );
    }

    const customEndpoint = source.endpoint
      ? this.azureBlobEndpoint(source.endpoint)
      : undefined;
    // Only a custom endpoint takes the BlobEndpoint form, because that form
    // is what the endpoint allowlist gates. The standard public endpoint is
    // expressed as EndpointSuffix=core.windows.net for both auth modes, so a
    // SAS token against plain Azure needs no allowlist entry any more than an
    // account key does.
    let connectionString: string;
    if (sasToken && customEndpoint) {
      connectionString = [
        `BlobEndpoint=${customEndpoint}`,
        `AccountName=${accountName}`,
        `SharedAccessSignature=${sasToken}`,
      ].join(';');
    } else if (sasToken) {
      connectionString = `DefaultEndpointsProtocol=https;AccountName=${accountName};SharedAccessSignature=${sasToken};EndpointSuffix=core.windows.net`;
    } else if (customEndpoint) {
      connectionString = [
        `DefaultEndpointsProtocol=${new URL(customEndpoint).protocol.slice(0, -1)}`,
        `AccountName=${accountName}`,
        `AccountKey=${accountKey}`,
        `BlobEndpoint=${customEndpoint}`,
      ].join(';');
    } else {
      connectionString = `DefaultEndpointsProtocol=https;AccountName=${accountName};AccountKey=${accountKey};EndpointSuffix=core.windows.net`;
    }

    // Re-parse generated strings as if they were user-supplied. This prevents
    // a key or SAS token containing ";" from injecting a BlobEndpoint field.
    return this.validateAzureConnectionString(connectionString);
  }

  private azureBlobEndpoint(endpoint: string): string {
    let uri: URL;
    try {
      uri = new URL(endpoint);
    } catch {
      throw new BadRequestException(
        'Azure endpoint must include http:// or https://',
      );
    }
    if (
      !['http:', 'https:'].includes(uri.protocol) ||
      uri.username ||
      uri.password ||
      uri.search ||
      uri.hash ||
      endpoint.includes(';')
    ) {
      throw new BadRequestException(
        'Azure endpoint must be an HTTP(S) URL without credentials, query, fragment, or semicolons',
      );
    }
    const normalized = uri.toString().replace(/\/$/, '');
    this.assertEndpointAllowed(normalized, 'Azure endpoint');
    return normalized;
  }

  private validateAzureConnectionString(connectionString: string): string {
    const normalized = connectionString.trim();
    const fields = new Map<string, string>();
    const allowedFields = new Set([
      'defaultendpointsprotocol',
      'accountname',
      'accountkey',
      'endpointsuffix',
      'blobendpoint',
      'sharedaccesssignature',
    ]);

    for (const segment of normalized.split(';')) {
      if (!segment) continue;
      const separator = segment.indexOf('=');
      if (separator <= 0) {
        throw new BadRequestException(
          'Azure connectionString contains an invalid field',
        );
      }
      const key = segment.slice(0, separator).trim().toLowerCase();
      const value = segment.slice(separator + 1).trim();
      if (!allowedFields.has(key) || !value || fields.has(key)) {
        throw new BadRequestException(
          'Azure connectionString contains an invalid or duplicate field',
        );
      }
      fields.set(key, value);
    }

    const accountName = fields.get('accountname');
    const accountKey = fields.get('accountkey');
    const sasToken = fields.get('sharedaccesssignature');
    if (
      !accountName ||
      !/^[a-zA-Z0-9]+$/.test(accountName) ||
      Boolean(accountKey) === Boolean(sasToken)
    ) {
      throw new BadRequestException(
        'Azure connectionString requires AccountName and exactly one authentication method',
      );
    }

    const blobEndpoint = fields.get('blobendpoint');
    const protocol = fields.get('defaultendpointsprotocol');
    const suffix = fields.get('endpointsuffix') ?? 'core.windows.net';
    if (protocol !== undefined && protocol !== 'http' && protocol !== 'https') {
      throw new BadRequestException(
        'Azure connectionString has an invalid endpoint protocol',
      );
    }
    if (blobEndpoint) {
      const endpoint = this.parseAzureBlobEndpoint(blobEndpoint);
      this.assertEndpointAllowed(endpoint, 'Azure BlobEndpoint');
    } else if (suffix === 'core.windows.net') {
      if (protocol !== 'https') {
        throw new BadRequestException(
          'Standard Azure connection strings require HTTPS',
        );
      }
    } else {
      if (protocol !== 'http' && protocol !== 'https') {
        throw new BadRequestException(
          'Azure connectionString has an invalid endpoint protocol',
        );
      }
      if (
        !/^[a-zA-Z0-9.-]+$/.test(suffix) ||
        suffix.startsWith('.') ||
        suffix.endsWith('.')
      ) {
        throw new BadRequestException(
          'Azure connectionString has an invalid EndpointSuffix',
        );
      }
      this.assertEndpointAllowed(
        `${protocol}://${accountName}.blob.${suffix}`,
        'Azure EndpointSuffix',
      );
    }

    return normalized;
  }

  private parseAzureBlobEndpoint(endpoint: string): string {
    let uri: URL;
    try {
      uri = new URL(endpoint);
    } catch {
      throw new BadRequestException(
        'Azure BlobEndpoint must be an HTTP(S) URL',
      );
    }
    if (
      !['http:', 'https:'].includes(uri.protocol) ||
      uri.username ||
      uri.password ||
      uri.search ||
      uri.hash ||
      endpoint.includes(';')
    ) {
      throw new BadRequestException(
        'Azure BlobEndpoint must be an HTTP(S) URL without credentials, query, fragment, or semicolons',
      );
    }
    return uri.toString().replace(/\/$/, '');
  }

  private assertEndpointAllowed(endpoint: string, label: string): void {
    const allowed = (process.env.LAKEHOUSE_ALLOWED_ENDPOINTS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => {
        try {
          return new URL(value).toString().replace(/\/$/, '');
        } catch {
          return '';
        }
      });
    if (!allowed.includes(endpoint)) {
      throw new BadRequestException(
        `${label} is not allowed by the server; add its exact URL to LAKEHOUSE_ALLOWED_ENDPOINTS`,
      );
    }
  }

  private authorizedLocalPath(path: string): string {
    const allowedRoot = process.env.LAKEHOUSE_LOCAL_ROOT;
    if (process.env.LAKEHOUSE_ALLOW_LOCAL_PATHS !== 'true' || !allowedRoot) {
      throw new BadRequestException(
        'Local lakehouse paths are disabled on this server',
      );
    }
    let filesystemPath: string;
    try {
      filesystemPath = path.startsWith('file://') ? fileURLToPath(path) : path;
    } catch {
      throw new BadRequestException('Invalid local lakehouse file URI');
    }
    if (!isAbsolute(filesystemPath)) {
      throw new BadRequestException(
        'Local lakehouse paths must be absolute paths or file:/// URIs',
      );
    }
    let root: string;
    let candidate: string;
    try {
      root = realpathSync(resolve(allowedRoot));
      candidate = realpathSync(resolve(filesystemPath));
    } catch {
      throw new BadRequestException(
        'Local lakehouse root and table path must exist',
      );
    }
    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
      throw new BadRequestException(
        'Local lakehouse path is outside LAKEHOUSE_LOCAL_ROOT',
      );
    }
    return candidate;
  }

  private assertDirectMetadataPath(
    format: LakehouseFormat,
    path: string,
  ): void {
    if (format === 'iceberg' && !path.endsWith('.metadata.json')) {
      throw new BadRequestException(
        'Direct Iceberg sources require a .metadata.json path',
      );
    }
    if (
      format === 'delta' &&
      (path.includes('/_delta_log/') || path.endsWith('/_delta_log'))
    ) {
      throw new BadRequestException(
        'Direct Delta sources require the table root, not _delta_log',
      );
    }
  }

  /**
   * Resolves an API time-travel point to a concrete commit reference. A
   * `timestamp` resolves to the commit at-or-before that instant (design doc
   * §4) by consulting the same history the slider renders, so query plans
   * only ever receive a version or snapshot id.
   */
  private async resolveTimeTravelPoint(
    format: string,
    point: TimeTravelPointDto | undefined,
    execution: ExecutionConfiguration,
  ): Promise<LakehouseTimeTravel | undefined> {
    if (!point) return undefined;
    if (format === 'iceberg' && point.kind === 'version') {
      return this.resolveIcebergSequence(point.version, execution);
    }
    if (point.kind !== 'timestamp') {
      return this.resolveTimeTravel(format, point);
    }

    const instant = Date.parse(point.iso);
    if (!Number.isFinite(instant)) {
      throw new BadRequestException('asOf timestamp must be a valid instant');
    }
    let entries: LakehouseHistoryEntry[];
    try {
      entries = await this.historyEntries(
        format,
        execution,
        MAX_HISTORY_ENTRIES,
      );
    } catch (error) {
      this.rethrowQueryError(error);
    }
    // Entries are oldest-first; take the last commit at or before the instant.
    const resolved = [...entries]
      .reverse()
      .find(
        (entry) =>
          entry.timestamp !== undefined &&
          Date.parse(entry.timestamp) <= instant,
      );
    if (!resolved) {
      throw new BadRequestException(
        'No commit exists at or before the requested timestamp',
      );
    }
    return resolved.ref;
  }

  /**
   * Design §1 types `version` as "Delta version / Iceberg sequence". An
   * Iceberg commit carries both a sequence number and a snapshot id, and
   * `iceberg_scan` selects only by the latter (handed a sequence it answers
   * `Could not find snapshot with id 2`), so the sequence is resolved to its
   * snapshot through the same history listing the timestamp path uses. Query
   * plans therefore still only ever see a concrete version or snapshot id,
   * and the public history shape (design §4) is unchanged.
   */
  private async resolveIcebergSequence(
    sequence: number,
    execution: ExecutionConfiguration,
  ): Promise<LakehouseTimeTravel> {
    let rows: Array<Record<string, unknown>>;
    try {
      rows = await this.withStorageSecret(execution, (connection) =>
        this.duckDb.queryRows(
          connection,
          planLakehouseHistory(execution.ref, MAX_HISTORY_ENTRIES),
        ),
      );
    } catch (error) {
      this.rethrowQueryError(error);
    }

    const match = rows.find(
      (row) =>
        this.safeInteger(row.sequence_number, 'sequence_number') === sequence,
    );
    if (!match) {
      throw new BadRequestException('No commit exists with that version');
    }
    return {
      kind: 'snapshot',
      snapshotId: this.requiredIntegerString(match.snapshot_id, 'snapshot_id'),
    };
  }

  /**
   * Delta has only a version and Iceberg only a snapshot id at the plan
   * layer; an Iceberg `version` is resolved to a snapshot before it gets
   * here, so a mismatch at this point is a genuinely wrong request.
   */
  private resolveTimeTravel(
    format: string,
    point: Exclude<TimeTravelPointDto, { kind: 'timestamp' }>,
  ): LakehouseTimeTravel {
    if (format === 'delta' && point.kind === 'version') return point;
    if (format === 'iceberg' && point.kind === 'snapshot') return point;
    throw new BadRequestException(
      `The selected commit does not match the ${format} source format`,
    );
  }

  private mapHistory(
    format: string,
    rows: Array<Record<string, unknown>>,
  ): LakehouseHistoryEntry[] {
    if (format === 'iceberg') {
      return rows.map((row) => ({
        ref: {
          kind: 'snapshot',
          snapshotId: this.requiredIntegerString(
            row.snapshot_id,
            'snapshot_id',
          ),
        },
        timestamp: this.isoTimestamp(row.timestamp_ms),
      }));
    }

    return rows.map((row) => {
      const timestamp = this.optionalIsoTimestamp(row.timestamp);
      return {
        ref: {
          kind: 'version',
          version: this.safeInteger(row.version, 'version'),
        },
        ...(timestamp !== undefined && { timestamp }),
        ...(typeof row.operation === 'string' && {
          operation: row.operation,
        }),
      };
    });
  }

  private optionalIsoTimestamp(value: unknown): string | undefined {
    if (value === null || value === undefined) return undefined;
    return this.isoTimestamp(value);
  }

  private isoTimestamp(value: unknown): string {
    if (typeof value === 'number') {
      const result = new Date(value);
      if (!Number.isNaN(result.getTime())) return result.toISOString();
    }
    if (typeof value === 'string') {
      if (/^[0-9]+$/.test(value)) {
        const result = new Date(Number(value));
        if (!Number.isNaN(result.getTime())) return result.toISOString();
      }
      const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value)
        ? `${value.replace(' ', 'T')}Z`
        : value;
      const result = new Date(normalized);
      if (!Number.isNaN(result.getTime())) return result.toISOString();
    }
    throw new Error('Lakehouse history contains an invalid timestamp');
  }

  private requiredIntegerString(value: unknown, label: string): string {
    if (
      (typeof value === 'string' && /^[0-9]+$/.test(value)) ||
      (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
    ) {
      return String(value);
    }
    throw new Error(`Lakehouse history contains an invalid ${label}`);
  }

  private safeInteger(value: unknown, label: string): number {
    const parsed =
      typeof value === 'string' && /^[0-9]+$/.test(value)
        ? Number(value)
        : value;
    if (
      typeof parsed === 'number' &&
      Number.isSafeInteger(parsed) &&
      parsed >= 0
    ) {
      return parsed;
    }
    throw new Error(`Lakehouse history contains an invalid ${label}`);
  }

  private updatedConfiguration(
    existing: LakehouseSource,
    dto: UpdateLakehouseSourceDto,
  ): {
    source: SourceConfiguration;
    credentials: LakehouseCredentialsDto;
    storageChanged: boolean;
    targetChanged: boolean;
    credentialsChanged: boolean;
  } {
    const source = this.updatedSource(existing, dto);
    const storage = this.assertStorage(source.storage);
    const storageChanged = storage !== existing.storage;
    const targetChanged =
      this.targetIdentity(source) !==
      this.targetIdentity(this.updatedSource(existing, {}));
    // A transient test may target a different origin/path, but it must never
    // inherit credentials hidden from the workspace member making the request.
    const existingCredentials = targetChanged
      ? {}
      : this.decryptCredentials(existing);
    const credentialsChanged =
      dto.credentials !== undefined &&
      Object.values(dto.credentials).some((value) => value !== undefined);
    const credentials = !credentialsChanged
      ? this.normalizeCredentials(storage, existingCredentials)
      : this.mergeCredentials(
          storage,
          existingCredentials,
          dto.credentials as LakehouseCredentialsDto,
        );

    return {
      source,
      credentials,
      storageChanged,
      targetChanged,
      credentialsChanged,
    };
  }

  private updatedSource(
    existing: LakehouseSource,
    dto: UpdateLakehouseSourceDto,
  ): SourceConfiguration {
    const storage = this.assertStorage(dto.storage ?? existing.storage);
    return {
      format: dto.format ?? existing.format,
      storage,
      ...this.normalizeConnectionFields(storage, {
        endpoint: dto.endpoint !== undefined ? dto.endpoint : existing.endpoint,
        region: dto.region !== undefined ? dto.region : existing.region,
        bucket: dto.bucket !== undefined ? dto.bucket : existing.bucket,
      }),
      basePath: dto.basePath ?? existing.basePath,
      catalogMode: dto.catalogMode ?? existing.catalogMode,
      catalogUri:
        dto.catalogUri !== undefined ? dto.catalogUri : existing.catalogUri,
    };
  }

  private targetIdentity(source: SourceConfiguration): string {
    const normalized = (value: string | null | undefined): string =>
      value?.trim().replace(/\/$/, '') ?? '';
    return JSON.stringify([
      source.storage,
      normalized(source.endpoint),
      normalized(source.bucket),
      normalized(source.basePath),
      source.catalogMode ?? 'direct_metadata',
      normalized(source.catalogUri),
    ]);
  }

  private normalizeConnectionFields(
    storage: LakehouseStorage,
    fields: Pick<SourceConfiguration, 'endpoint' | 'region' | 'bucket'>,
  ): Pick<SourceConfiguration, 'endpoint' | 'region' | 'bucket'> {
    return {
      // gcs keeps a custom endpoint for the schema's GCS-interop case.
      endpoint:
        storage === 's3-compatible' || storage === 'azure' || storage === 'gcs'
          ? fields.endpoint
          : null,
      region:
        storage === 's3' || storage === 's3-compatible' ? fields.region : null,
      bucket: storage === 'local' ? null : fields.bucket,
    };
  }

  private normalizeCredentials(
    storage: LakehouseStorage,
    raw: LakehouseCredentialsDto,
  ): LakehouseCredentialsDto {
    if (storage === 'local') {
      this.assertCredentialFields(storage, raw, []);
      return {};
    }

    // catalogToken rides along for every object-storage kind: the catalog is
    // orthogonal to where its data files live, so the packed blob keeps the
    // storage fields and the optional REST-catalog bearer token side by side.
    const catalogToken = raw.catalogToken?.trim()
      ? { catalogToken: raw.catalogToken }
      : {};

    if (storage === 's3' || storage === 's3-compatible') {
      this.assertCredentialFields(storage, raw, [
        'accessKeyId',
        'secretAccessKey',
        'sessionToken',
        'catalogToken',
      ]);
      const accessKeyId = raw.accessKeyId?.trim();
      const secretAccessKey = raw.secretAccessKey;
      if (!accessKeyId || !secretAccessKey?.trim()) {
        throw new BadRequestException(
          `${storage} requires accessKeyId and secretAccessKey`,
        );
      }
      return {
        accessKeyId,
        secretAccessKey,
        ...(raw.sessionToken?.trim() && {
          sessionToken: raw.sessionToken,
        }),
        ...catalogToken,
      };
    }

    if (storage === 'gcs') {
      this.assertCredentialFields(storage, raw, [
        'accessKeyId',
        'secretAccessKey',
        'catalogToken',
      ]);
      const accessKeyId = raw.accessKeyId?.trim();
      const secretAccessKey = raw.secretAccessKey;
      if (!accessKeyId || !secretAccessKey?.trim()) {
        throw new BadRequestException(
          'gcs requires accessKeyId and secretAccessKey',
        );
      }
      return { accessKeyId, secretAccessKey, ...catalogToken };
    }

    this.assertCredentialFields(storage, raw, [
      'accountName',
      'accountKey',
      'connectionString',
      'sasToken',
      'catalogToken',
    ]);
    const hasConnectionString = raw.connectionString !== undefined;
    const hasAccountMode = [raw.accountName, raw.accountKey, raw.sasToken].some(
      (value) => value !== undefined,
    );
    if (hasConnectionString && hasAccountMode) {
      throw new BadRequestException(
        'Azure connectionString cannot be combined with account credentials',
      );
    }
    if (hasConnectionString) {
      const connectionString = raw.connectionString?.trim();
      if (!connectionString) {
        throw new BadRequestException('Azure connectionString cannot be empty');
      }
      return { connectionString, ...catalogToken };
    }

    const accountName = raw.accountName?.trim();
    const accountKey = raw.accountKey;
    const sasToken = raw.sasToken?.replace(/^\?/, '');
    const hasAccountKey = Boolean(accountKey?.trim());
    const hasSasToken = Boolean(sasToken?.trim());
    if (!accountName || hasAccountKey === hasSasToken) {
      throw new BadRequestException(
        'Azure requires accountName and exactly one of accountKey or sasToken',
      );
    }
    return {
      accountName,
      ...(hasAccountKey ? { accountKey } : { sasToken }),
      ...catalogToken,
    };
  }

  private assertCredentialFields(
    storage: LakehouseStorage,
    credentials: LakehouseCredentialsDto,
    allowed: Array<keyof LakehouseCredentialsDto>,
  ): void {
    const allowedFields = new Set<string>(allowed);
    const unexpected = Object.entries(credentials)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key)
      .filter((key) => !allowedFields.has(key));
    if (unexpected.length > 0) {
      throw new BadRequestException(
        `${storage} does not accept credential field ${unexpected[0]}`,
      );
    }
  }

  private decryptCredentials(
    source: Pick<LakehouseSource, 'credentials'>,
  ): LakehouseCredentialsDto {
    // The column is nullable so the blob can be written in a second step
    // (create→test→save); a source without one is not usable yet.
    if (!source.credentials) {
      throw new BadRequestException(
        'Lakehouse source has no saved credentials',
      );
    }
    try {
      const value: unknown = JSON.parse(decrypt(source.credentials));
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('Credentials are not an object');
      }
      return value as LakehouseCredentialsDto;
    } catch {
      throw new BadRequestException(
        'Stored lakehouse credentials cannot be decrypted',
      );
    }
  }

  private mergeCredentials(
    storage: LakehouseStorage,
    existing: LakehouseCredentialsDto,
    incoming: LakehouseCredentialsDto,
  ): LakehouseCredentialsDto {
    // The catalog bearer token merges independently of the storage fields:
    // an explicit value (or empty string, to clear) wins, otherwise the
    // stored one is kept. The storage-specific rules below never see it.
    const { catalogToken: existingToken, ...existingRest } = existing;
    const { catalogToken: incomingToken, ...incomingRest } = incoming;
    const merged = this.mergeStorageCredentials(
      storage,
      existingRest,
      incomingRest,
    );
    const catalogToken =
      incomingToken !== undefined ? incomingToken : existingToken;
    return {
      ...merged,
      ...(catalogToken?.trim() && { catalogToken }),
    };
  }

  private mergeStorageCredentials(
    storage: LakehouseStorage,
    existing: LakehouseCredentialsDto,
    incoming: LakehouseCredentialsDto,
  ): LakehouseCredentialsDto {
    if (storage === 'local') {
      return this.normalizeCredentials(storage, incoming);
    }

    if (storage === 's3' || storage === 's3-compatible' || storage === 'gcs') {
      this.assertCredentialFields(
        storage,
        incoming,
        storage === 'gcs'
          ? ['accessKeyId', 'secretAccessKey']
          : ['accessKeyId', 'secretAccessKey', 'sessionToken'],
      );
      const changesAccessKey = incoming.accessKeyId !== undefined;
      const changesSecret = incoming.secretAccessKey !== undefined;
      if (changesAccessKey !== changesSecret) {
        throw new BadRequestException(
          'accessKeyId and secretAccessKey must be rotated together',
        );
      }
      const merged =
        changesAccessKey && changesSecret
          ? {
              accessKeyId: incoming.accessKeyId,
              secretAccessKey: incoming.secretAccessKey,
              ...(storage !== 'gcs' &&
                incoming.sessionToken?.trim() && {
                  sessionToken: incoming.sessionToken,
                }),
            }
          : { ...existing, ...incoming };
      return this.normalizeCredentials(storage, merged);
    }

    this.assertCredentialFields(storage, incoming, [
      'accountName',
      'accountKey',
      'connectionString',
      'sasToken',
    ]);
    const hasConnectionString = incoming.connectionString !== undefined;
    const changesAccountKey = incoming.accountKey !== undefined;
    const changesSasToken = incoming.sasToken !== undefined;
    if (changesAccountKey && changesSasToken) {
      throw new BadRequestException(
        'Azure accountKey and sasToken are mutually exclusive',
      );
    }
    const changesAccountName =
      incoming.accountName !== undefined &&
      incoming.accountName.trim() !== existing.accountName?.trim();
    if (changesAccountName && !changesAccountKey && !changesSasToken) {
      throw new BadRequestException(
        'Changing Azure accountName requires a fresh accountKey or sasToken',
      );
    }
    const hasAccountMode = [
      incoming.accountName,
      incoming.accountKey,
      incoming.sasToken,
    ].some((value) => value !== undefined);
    if (hasConnectionString && hasAccountMode) {
      throw new BadRequestException(
        'Azure connectionString cannot be combined with account credentials',
      );
    }
    if (hasConnectionString) {
      return this.normalizeCredentials(storage, {
        connectionString: incoming.connectionString,
      });
    }
    if (hasAccountMode) {
      const accountName = incoming.accountName ?? existing.accountName;
      const credentials =
        incoming.accountKey !== undefined
          ? { accountName, accountKey: incoming.accountKey }
          : incoming.sasToken !== undefined
            ? { accountName, sasToken: incoming.sasToken }
            : {
                accountName,
                accountKey: existing.accountKey,
                sasToken: existing.sasToken,
              };
      return this.normalizeCredentials(storage, credentials);
    }
    return this.normalizeCredentials(storage, existing);
  }

  private assertFormat(format: string): LakehouseFormat {
    if (format === 'iceberg' || format === 'delta') return format;
    throw new BadRequestException(`Unsupported lakehouse format: ${format}`);
  }

  private assertStorage(storage: string): LakehouseStorage {
    if (
      storage === 'local' ||
      storage === 's3' ||
      storage === 's3-compatible' ||
      storage === 'gcs' ||
      storage === 'azure'
    ) {
      return storage;
    }
    throw new BadRequestException(`Unsupported lakehouse storage: ${storage}`);
  }

  private mask<T extends { credentials: string | null }>(
    source: T,
  ): Omit<T, 'credentials'> & { credentials: string } {
    return { ...source, credentials: MASKED_CREDENTIALS };
  }

  private rethrowPersistenceError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'A lakehouse source with this name already exists in the workspace',
      );
    }
    throw error;
  }

  private rethrowQueryError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (error instanceof DuckDbQueryTimeoutError) {
      throw new RequestTimeoutException(error.message);
    }
    if (
      error instanceof DuckDbPoolExhaustedError ||
      error instanceof DuckDbUnavailableError
    ) {
      throw new ServiceUnavailableException(error.message);
    }
    throw new BadRequestException('Lakehouse query failed');
  }

  private connectionTestError(error: unknown): string {
    if (
      error instanceof DuckDbQueryTimeoutError ||
      error instanceof DuckDbPoolExhaustedError ||
      error instanceof DuckDbUnavailableError
    ) {
      return error.message;
    }
    return 'Unable to connect to the lakehouse source';
  }
}
