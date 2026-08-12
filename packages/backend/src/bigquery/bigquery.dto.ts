import {
  IsInt,
  IsJSON,
  IsOptional,
  IsPositive,
  IsString,
  Length,
} from 'class-validator';

export class CreateBigQuerySourceDto {
  @IsString()
  @Length(1, 100)
  name: string;

  @IsString()
  @Length(1, 100)
  projectId: string;

  @IsOptional()
  @IsString()
  @Length(1, 1024)
  dataset?: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  location?: string;

  // Raw service-account JSON key contents (encrypted before storage).
  @IsJSON()
  @Length(1, 65_536)
  credentials: string;

  // `@IsOptional()` also lets an explicit `null` through (not just a
  // missing key); the type says so too, since the service treats `null`
  // as "no ceiling" rather than a value to reject.
  @IsOptional()
  @IsInt()
  @IsPositive()
  maximumBytesBilled?: number | null;
}

export class UpdateBigQuerySourceDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  projectId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 1024)
  dataset?: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  location?: string;

  @IsOptional()
  @IsJSON()
  @Length(1, 65_536)
  credentials?: string;

  // `null` explicitly clears a previously-set ceiling; omitting the key
  // leaves it unchanged.
  @IsOptional()
  @IsInt()
  @IsPositive()
  maximumBytesBilled?: number | null;
}

/**
 * Connection fields for validating a BigQuery connection before it is
 * persisted. Mirrors CreateBigQuerySourceDto without `name`, which is
 * irrelevant to a probe.
 */
export class TestBigQueryConnectionDto {
  @IsString()
  @Length(1, 100)
  projectId: string;

  @IsOptional()
  @IsString()
  @Length(1, 1024)
  dataset?: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  location?: string;

  @IsJSON()
  @Length(1, 65_536)
  credentials: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  maximumBytesBilled?: number;
}
