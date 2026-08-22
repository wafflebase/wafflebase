import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Matches,
  MaxLength,
  Min,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export const LAKEHOUSE_FORMATS = ['iceberg', 'delta'] as const;
export type LakehouseFormat = (typeof LAKEHOUSE_FORMATS)[number];

export const LAKEHOUSE_STORAGES = [
  'local',
  's3',
  's3-compatible',
  'gcs',
  'azure',
] as const;
export type LakehouseStorage = (typeof LAKEHOUSE_STORAGES)[number];

// Mirrors the Prisma CatalogMode enum. `unity` exists in the schema for
// forward compatibility but has no attach path yet, so creating a unity
// source is rejected at the service layer.
export const LAKEHOUSE_CATALOG_MODES = [
  'direct_metadata',
  'rest_catalog',
  's3_tables',
  'unity',
] as const;
export type LakehouseCatalogMode = (typeof LAKEHOUSE_CATALOG_MODES)[number];

export class LakehouseCredentialsDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(512)
  accessKeyId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(4096)
  secretAccessKey?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(8192)
  sessionToken?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(512)
  accountName?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(4096)
  accountKey?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(8192)
  connectionString?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(8192)
  sasToken?: string;

  /** Bearer token for an Iceberg REST catalog (the "oauth" slot of the packed blob). */
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(8192)
  catalogToken?: string;
}

export class CreateLakehouseSourceDto {
  @IsString()
  @Length(1, 100)
  @Matches(/\S/)
  name: string;

  @IsIn(LAKEHOUSE_FORMATS)
  format: LakehouseFormat;

  @IsIn(LAKEHOUSE_STORAGES)
  storage: LakehouseStorage;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  endpoint?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/)
  bucket?: string | null;

  // Required for direct-metadata sources (enforced by the service); catalog
  // sources locate tables through the catalog instead.
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(1, 2048)
  @Matches(/\S/)
  basePath?: string;

  @IsOptional()
  @IsIn(LAKEHOUSE_CATALOG_MODES)
  catalogMode?: LakehouseCatalogMode;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(1, 2048)
  @Matches(/\S/)
  catalogUri?: string;

  @IsObject()
  @ValidateNested()
  @Type(() => LakehouseCredentialsDto)
  credentials: LakehouseCredentialsDto;
}

export class UpdateLakehouseSourceDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(1, 100)
  @Matches(/\S/)
  name?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(LAKEHOUSE_FORMATS)
  format?: LakehouseFormat;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(LAKEHOUSE_STORAGES)
  storage?: LakehouseStorage;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  endpoint?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  region?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/)
  bucket?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(1, 2048)
  @Matches(/\S/)
  basePath?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(LAKEHOUSE_CATALOG_MODES)
  catalogMode?: LakehouseCatalogMode;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(1, 2048)
  @Matches(/\S/)
  catalogUri?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => LakehouseCredentialsDto)
  credentials?: LakehouseCredentialsDto;
}

export type TimeTravelPointDto =
  | { kind: 'version'; version: number }
  | { kind: 'snapshot'; snapshotId: string }
  | { kind: 'timestamp'; iso: string };

@ValidatorConstraint({ name: 'timeTravelPoint', async: false })
class TimeTravelPointConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return false;
    }

    const point = value as Record<string, unknown>;
    const keys = Object.keys(point).sort();

    if (point.kind === 'version') {
      return (
        keys.join(',') === 'kind,version' &&
        Number.isSafeInteger(point.version) &&
        (point.version as number) >= 0
      );
    }

    if (point.kind === 'snapshot') {
      return (
        keys.join(',') === 'kind,snapshotId' &&
        typeof point.snapshotId === 'string' &&
        point.snapshotId.length <= 19 &&
        /^(0|[1-9][0-9]*)$/.test(point.snapshotId) &&
        BigInt(point.snapshotId) <= 9_223_372_036_854_775_807n
      );
    }

    if (point.kind === 'timestamp') {
      // The service resolves a timestamp to the commit at-or-before it, so the
      // only contract here is a parseable ISO-8601 instant.
      return (
        keys.join(',') === 'iso,kind' &&
        typeof point.iso === 'string' &&
        point.iso.length <= 64 &&
        Number.isFinite(Date.parse(point.iso))
      );
    }

    return false;
  }

  defaultMessage(): string {
    return 'asOf must be a non-negative version, a numeric snapshot id, or an ISO timestamp';
  }
}

/** Catalog-mode table reference: `namespace` levels + table name, no SQL. */
@ValidatorConstraint({ name: 'catalogTableRef', async: false })
class CatalogTableRefConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return false;
    }
    const ref = value as Record<string, unknown>;
    if (Object.keys(ref).sort().join(',') !== 'namespace,table') return false;
    const identifier = (candidate: unknown): boolean =>
      typeof candidate === 'string' &&
      candidate.length > 0 &&
      candidate.length <= 255 &&
      !candidate.includes(' ');
    return (
      Array.isArray(ref.namespace) &&
      ref.namespace.length >= 1 &&
      ref.namespace.length <= 8 &&
      ref.namespace.every(identifier) &&
      identifier(ref.table)
    );
  }

  defaultMessage(): string {
    return 'table must be { namespace: string[], table: string }';
  }
}

export type CatalogTableRefDto = { namespace: string[]; table: string };

export class ReadLakehouseDto {
  @ValidateIf((_object, value) => value !== undefined)
  @Validate(TimeTravelPointConstraint)
  asOf?: TimeTravelPointDto;

  /** Required for catalog-mode sources; rejected for direct-metadata ones
   *  (the read path enforces both halves). */
  @ValidateIf((_object, value) => value !== undefined)
  @Validate(CatalogTableRefConstraint)
  table?: CatalogTableRefDto;
}

export class LakehouseHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000)
  limit?: number;
}
