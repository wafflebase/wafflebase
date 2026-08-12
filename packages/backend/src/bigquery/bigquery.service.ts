import { Injectable, NotFoundException } from '@nestjs/common';
import { BigQuery } from '@google-cloud/bigquery';
import { PrismaService } from 'src/database/prisma.service';
import { encrypt, decrypt } from '../datasource/crypto.util';
import {
  CreateBigQuerySourceDto,
  TestBigQueryConnectionDto,
  UpdateBigQuerySourceDto,
} from './bigquery.dto';

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
