import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Client, types } from 'pg';
import { PrismaService } from 'src/database/prisma.service';
import { encrypt, decrypt } from './crypto.util';
import { validateSelectQuery, wrapWithRowLimit } from './sql-validator';
import {
  CreateDataSourceDto,
  UpdateDataSourceDto,
  ExecuteQueryDto,
  TestConnectionDto,
} from './datasource.dto';

const QUERY_TIMEOUT_MS = 30_000;
const MAX_ROWS = 10_000;

// Keep date/time types as raw Postgres text instead of JS `Date`, which the
// default parser shifts by the Node runtime timezone. (TIME/TIMETZ are strings.)
const RAW_TEXT_OIDS = new Set([
  types.builtins.DATE,
  types.builtins.TIMESTAMP,
  types.builtins.TIMESTAMPTZ,
]);

// pg-types types getTypeParser's return as `any`; pin it to avoid leaking `any`.
type ValueParser = (value: string) => unknown;
const getDefaultParser = types.getTypeParser as (
  oid: Parameters<typeof types.getTypeParser>[0],
  format?: Parameters<typeof types.getTypeParser>[1],
) => ValueParser;

const datasourceTypeParser: typeof types.getTypeParser = (oid, format) =>
  RAW_TEXT_OIDS.has(oid)
    ? (value: string) => value
    : getDefaultParser(oid, format);

const DEFAULT_PORT = 5432;

/**
 * Connection settings ready to hand to pg. The password field is deliberately
 * named apart from the stored record's `password`, so passing a Prisma row here
 * fails to compile instead of silently shipping ciphertext to the server.
 */
type ConnectionConfig = {
  host: string;
  port: number;
  database: string;
  username: string;
  plaintextPassword: string;
  sslEnabled: boolean;
};

/**
 * `client.connect()` rejects with an AggregateError when every address resolved
 * for the host fails — its `message` is empty and the real causes sit in
 * `errors`. Flatten those so callers get a reason instead of a blank string.
 */
function describeConnectionError(error: unknown): string {
  if (error instanceof AggregateError) {
    const causes = [
      ...new Set(
        (error.errors ?? [])
          .map((cause: unknown) => (cause as Error)?.message)
          .filter((message: string | undefined): message is string =>
            Boolean(message),
          ),
      ),
    ];
    if (causes.length > 0) {
      return causes.join('; ');
    }
  }

  return (error as Error)?.message || 'Connection failed';
}

@Injectable()
export class DataSourceService {
  constructor(private prisma: PrismaService) {}

  async create(userId: number, workspaceId: string, dto: CreateDataSourceDto) {
    return this.prisma.dataSource.create({
      data: {
        name: dto.name,
        host: dto.host,
        port: dto.port ?? DEFAULT_PORT,
        database: dto.database,
        username: dto.username,
        password: encrypt(dto.password),
        sslEnabled: dto.sslEnabled ?? false,
        authorID: userId,
        workspaceId,
      },
    });
  }

  async findAllByWorkspace(workspaceId: string) {
    const datasources = await this.prisma.dataSource.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });

    // Mask passwords
    return datasources.map((ds) => ({
      ...ds,
      password: '********',
    }));
  }

  async findOne(id: string) {
    const ds = await this.prisma.dataSource.findUnique({ where: { id } });
    if (!ds) {
      throw new NotFoundException('DataSource not found');
    }
    return { ...ds, password: '********' };
  }

  async update(id: string, dto: UpdateDataSourceDto) {
    const ds = await this.prisma.dataSource.findUnique({ where: { id } });
    if (!ds) {
      throw new NotFoundException('DataSource not found');
    }

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.host !== undefined) data.host = dto.host;
    if (dto.port !== undefined) data.port = dto.port;
    if (dto.database !== undefined) data.database = dto.database;
    if (dto.username !== undefined) data.username = dto.username;
    if (dto.password !== undefined) data.password = encrypt(dto.password);
    if (dto.sslEnabled !== undefined) data.sslEnabled = dto.sslEnabled;

    return this.prisma.dataSource.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    const ds = await this.prisma.dataSource.findUnique({ where: { id } });
    if (!ds) {
      throw new NotFoundException('DataSource not found');
    }
    return this.prisma.dataSource.delete({ where: { id } });
  }

  async testConnection(id: string) {
    const ds = await this.prisma.dataSource.findUnique({ where: { id } });
    if (!ds) {
      throw new NotFoundException('DataSource not found');
    }

    return this.probe(this.toConnectionConfig(ds));
  }

  /**
   * Validate connection settings that have not been saved yet, so the creation
   * dialog can test before persisting anything.
   */
  async testConfig(dto: TestConnectionDto) {
    return this.probe({
      host: dto.host,
      port: dto.port ?? DEFAULT_PORT,
      database: dto.database,
      username: dto.username,
      plaintextPassword: dto.password,
      sslEnabled: dto.sslEnabled ?? false,
    });
  }

  private async probe(
    config: ConnectionConfig,
  ): Promise<{ success: boolean; error?: string }> {
    const client = this.createClient(config);
    try {
      await client.connect();
      await client.query('SELECT 1');
      return { success: true };
    } catch (error) {
      return { success: false, error: describeConnectionError(error) };
    } finally {
      await client.end().catch(() => {});
    }
  }

  async executeQuery(id: string, dto: ExecuteQueryDto) {
    const validation = validateSelectQuery(dto.query);
    if (!validation.valid) {
      throw new BadRequestException(validation.error);
    }

    const ds = await this.prisma.dataSource.findUnique({ where: { id } });
    if (!ds) {
      throw new NotFoundException('DataSource not found');
    }

    const client = this.createClient(this.toConnectionConfig(ds));
    try {
      await client.connect();

      // Normalize output formatting only (not input parsing): UTC, ISO dates,
      // and C money — so results are deterministic across server locales.
      await client.query(`SET statement_timeout = '${QUERY_TIMEOUT_MS}'`);
      await client.query(`SET TimeZone = 'UTC'`);
      await client.query(`SET DateStyle = 'ISO'`);
      await client.query(`SET lc_monetary = 'C'`);

      const wrappedQuery = wrapWithRowLimit(dto.query, MAX_ROWS + 1);
      const startTime = Date.now();
      const result = await client.query(wrappedQuery);
      const executionTime = Date.now() - startTime;

      const truncated = result.rows.length > MAX_ROWS;
      const rows = truncated ? result.rows.slice(0, MAX_ROWS) : result.rows;

      return {
        columns: result.fields.map((f) => ({
          name: f.name,
          dataTypeID: f.dataTypeID,
        })),
        rows,
        rowCount: rows.length,
        truncated,
        executionTime,
      };
    } catch (error) {
      const pgError = error as { message?: string; code?: string };
      throw new BadRequestException(
        pgError.message || 'Query execution failed',
      );
    } finally {
      await client.end().catch(() => {});
    }
  }

  /**
   * Retrieve the raw datasource record (with workspaceId) for access
   * control checks in the controller layer.
   */
  async findRaw(id: string) {
    const ds = await this.prisma.dataSource.findUnique({ where: { id } });
    if (!ds) {
      throw new NotFoundException('DataSource not found');
    }
    return ds;
  }

  /** Decrypt a stored record into settings pg can consume. */
  private toConnectionConfig(ds: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    sslEnabled: boolean;
  }): ConnectionConfig {
    return {
      host: ds.host,
      port: ds.port,
      database: ds.database,
      username: ds.username,
      plaintextPassword: decrypt(ds.password),
      sslEnabled: ds.sslEnabled,
    };
  }

  private createClient(config: ConnectionConfig): Client {
    return new Client({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.plaintextPassword,
      ssl: config.sslEnabled ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 10_000,
      types: { getTypeParser: datasourceTypeParser },
    });
  }
}
