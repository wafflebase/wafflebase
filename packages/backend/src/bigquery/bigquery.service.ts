import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  BigQuery,
  BigQueryDate,
  BigQueryDatetime,
  BigQueryTime,
  BigQueryTimestamp,
  BigQueryInt,
  Geography,
} from '@google-cloud/bigquery';
import { PrismaService } from 'src/database/prisma.service';
import { encrypt, decrypt } from '../datasource/crypto.util';
import {
  validateSelectQuery,
  wrapWithRowLimit,
} from '../datasource/sql-validator';
import { ExecuteQueryDto } from '../datasource/datasource.dto';
import {
  CreateBigQuerySourceDto,
  TestBigQueryConnectionDto,
  UpdateBigQuerySourceDto,
} from './bigquery.dto';

const MAX_ROWS = 10_000;

/**
 * The wrapper classes the BigQuery client uses for DATE/DATETIME/TIME/
 * TIMESTAMP/GEOGRAPHY/INT64 values all carry the raw server value on
 * `.value` — unwrap those (and Buffer/Big.js instances the client also
 * returns for BYTES/NUMERIC) into plain, JSON-friendly values recursively,
 * so STRUCT/ARRAY nesting round-trips through `toCell` cleanly instead of
 * rendering as `{"value":"..."}`.
 */
const VALUE_WRAPPER_CLASSES = [
  BigQueryDate,
  BigQueryDatetime,
  BigQueryTime,
  BigQueryTimestamp,
  BigQueryInt,
  Geography,
];

function unwrapBigQueryValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (Array.isArray(value)) return value.map(unwrapBigQueryValue);

  if (VALUE_WRAPPER_CLASSES.some((cls) => value instanceof cls)) {
    return (value as { value: unknown }).value;
  }

  if (typeof value === 'object') {
    // Big.js instances (NUMERIC/BIGNUMERIC) are duck-typed rather than
    // imported, since `big.js` is only a transitive dependency here.
    if (typeof (value as { toFixed?: unknown }).toFixed === 'function') {
      return (value as { toString(): string }).toString();
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [
        key,
        unwrapBigQueryValue(val),
      ]),
    );
  }

  return value;
}

/**
 * Connection settings ready to hand to the BigQuery client. The credentials
 * field is deliberately named apart from the stored record's `credentials`,
 * so passing a Prisma row here fails to compile instead of silently shipping
 * ciphertext as the service-account key.
 */
type ConnectionConfig = {
  projectId: string;
  dataset?: string | null;
  location?: string | null;
  plaintextCredentials: string;
};

/**
 * The BigQuery client surfaces Google API errors either as a plain `Error`
 * or, for grouped API failures, an object carrying an `errors` array whose
 * entries hold the real per-cause `message` — flatten those into one string
 * instead of leaking `[object Object]` or an empty message.
 */
function describeConnectionError(error: unknown): string {
  const withErrors = error as { errors?: Array<{ message?: string }> };
  if (Array.isArray(withErrors?.errors)) {
    const causes = [
      ...new Set(
        withErrors.errors
          .map((cause) => cause?.message)
          .filter((message): message is string => Boolean(message)),
      ),
    ];
    if (causes.length > 0) {
      return causes.join('; ');
    }
  }

  return (error as Error)?.message || 'Connection failed';
}

/**
 * Converts a DTO's `maximumBytesBilled` into the shape Prisma expects.
 * `undefined` (the key is absent) passes through unchanged so update() can
 * tell "leave it alone" apart from "clear it"; `null` (explicitly clear)
 * and a number (set the ceiling) both need `BigInt` kept out of their way —
 * `BigInt(null)` throws, so this is the one place that distinction is made,
 * shared by create() and update() instead of duplicated in each.
 */
function toBillingCeiling(
  value: number | null | undefined,
): bigint | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : BigInt(value);
}

@Injectable()
export class BigQueryService {
  constructor(private prisma: PrismaService) {}

  async create(
    userId: number,
    workspaceId: string,
    dto: CreateBigQuerySourceDto,
  ) {
    return this.prisma.bigQuerySource.create({
      data: {
        name: dto.name,
        projectId: dto.projectId,
        dataset: dto.dataset,
        location: dto.location,
        credentials: encrypt(dto.credentials),
        maximumBytesBilled: toBillingCeiling(dto.maximumBytesBilled),
        authorID: userId,
        workspaceId,
      },
    });
  }

  async findAllByWorkspace(workspaceId: string) {
    const sources = await this.prisma.bigQuerySource.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });

    return sources.map((source) => this.toApiShape(source));
  }

  async findOne(id: string) {
    const source = await this.prisma.bigQuerySource.findUnique({
      where: { id },
    });
    if (!source) {
      throw new NotFoundException('BigQuerySource not found');
    }
    return this.toApiShape(source);
  }

  async update(id: string, dto: UpdateBigQuerySourceDto) {
    const source = await this.prisma.bigQuerySource.findUnique({
      where: { id },
    });
    if (!source) {
      throw new NotFoundException('BigQuerySource not found');
    }

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.projectId !== undefined) data.projectId = dto.projectId;
    if (dto.dataset !== undefined) data.dataset = dto.dataset;
    if (dto.location !== undefined) data.location = dto.location;
    if (dto.credentials !== undefined)
      data.credentials = encrypt(dto.credentials);
    if (dto.maximumBytesBilled !== undefined)
      data.maximumBytesBilled = toBillingCeiling(dto.maximumBytesBilled);

    return this.prisma.bigQuerySource.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    const source = await this.prisma.bigQuerySource.findUnique({
      where: { id },
    });
    if (!source) {
      throw new NotFoundException('BigQuerySource not found');
    }
    return this.prisma.bigQuerySource.delete({ where: { id } });
  }

  async testConnection(id: string) {
    const source = await this.prisma.bigQuerySource.findUnique({
      where: { id },
    });
    if (!source) {
      throw new NotFoundException('BigQuerySource not found');
    }

    return this.probe(this.toConnectionConfig(source));
  }

  /**
   * Validate connection settings that have not been saved yet, so the
   * creation dialog can test before persisting anything.
   */
  async testConfig(dto: TestBigQueryConnectionDto) {
    return this.probe({
      projectId: dto.projectId,
      dataset: dto.dataset,
      location: dto.location,
      plaintextCredentials: dto.credentials,
    });
  }

  /**
   * Dry-runs a trivial query, which validates auth and IAM permissions
   * without scanning any bytes (dry runs are always free).
   */
  private async probe(
    config: ConnectionConfig,
  ): Promise<{ success: boolean; error?: string }> {
    const client = this.createClient(config);
    try {
      await client.createQueryJob({ query: 'SELECT 1', dryRun: true });
      return { success: true };
    } catch (error) {
      return { success: false, error: describeConnectionError(error) };
    }
  }

  async executeQuery(id: string, dto: ExecuteQueryDto) {
    const validation = validateSelectQuery(dto.query);
    if (!validation.valid) {
      throw new BadRequestException(validation.error);
    }

    const source = await this.prisma.bigQuerySource.findUnique({
      where: { id },
    });
    if (!source) {
      throw new NotFoundException('BigQuerySource not found');
    }

    const client = this.createClient(this.toConnectionConfig(source));
    try {
      const wrappedQuery = wrapWithRowLimit(dto.query, MAX_ROWS + 1);
      const startTime = Date.now();
      const [job] = await client.createQueryJob({
        query: wrappedQuery,
        location: source.location ?? undefined,
        defaultDataset: source.dataset
          ? { datasetId: source.dataset }
          : undefined,
        maximumBytesBilled:
          source.maximumBytesBilled != null
            ? source.maximumBytesBilled.toString()
            : undefined,
      });
      const [rawRows, , apiResponse] = await job.getQueryResults();
      const executionTime = Date.now() - startTime;

      const truncated = rawRows.length > MAX_ROWS;
      const rows = (truncated ? rawRows.slice(0, MAX_ROWS) : rawRows).map(
        (row) => unwrapBigQueryValue(row),
      ) as Array<Record<string, unknown>>;

      return {
        columns: (apiResponse?.schema?.fields ?? []).map((field) => ({
          name: field.name!,
          // A BigQuery type name (e.g. "STRING", "TIMESTAMP"), not a pg
          // OID — the field is kept for shape parity with the datasource
          // connector, since neither ReadOnlyStore nor the frontend
          // currently consumes it for cell formatting.
          dataTypeID: field.type!,
        })),
        rows,
        rowCount: rows.length,
        truncated,
        executionTime,
      };
    } catch (error) {
      throw new BadRequestException(describeConnectionError(error));
    }
  }

  /**
   * Retrieve the raw source record (with workspaceId) for access control
   * checks in the controller layer.
   */
  async findRaw(id: string) {
    const source = await this.prisma.bigQuerySource.findUnique({
      where: { id },
    });
    if (!source) {
      throw new NotFoundException('BigQuerySource not found');
    }
    return source;
  }

  private toApiShape(source: {
    credentials: string;
    maximumBytesBilled: bigint | null;
    [key: string]: unknown;
  }) {
    return {
      ...source,
      credentials: '********',
      maximumBytesBilled:
        source.maximumBytesBilled != null
          ? Number(source.maximumBytesBilled)
          : null,
    };
  }

  /** Decrypt a stored record into settings the BigQuery client can consume. */
  private toConnectionConfig(source: {
    projectId: string;
    dataset: string | null;
    location: string | null;
    credentials: string;
  }): ConnectionConfig {
    return {
      projectId: source.projectId,
      dataset: source.dataset,
      location: source.location,
      plaintextCredentials: decrypt(source.credentials),
    };
  }

  private createClient(config: ConnectionConfig): BigQuery {
    return new BigQuery({
      projectId: config.projectId,
      location: config.location ?? undefined,
      credentials: JSON.parse(config.plaintextCredentials),
    });
  }
}
