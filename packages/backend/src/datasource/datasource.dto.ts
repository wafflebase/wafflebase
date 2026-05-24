import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

export class CreateDataSourceDto {
  @IsString()
  @Length(1, 100)
  name: string;

  @IsString()
  @Length(1, 253)
  host: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsString()
  @Length(1, 100)
  database: string;

  @IsString()
  @Length(1, 100)
  username: string;

  @IsString()
  @Length(0, 256)
  password: string;

  @IsOptional()
  @IsBoolean()
  sslEnabled?: boolean;
}

export class CreateDataSourceInWorkspaceDto extends CreateDataSourceDto {
  @IsUUID()
  workspaceId: string;
}

export class UpdateDataSourceDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 253)
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  database?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  username?: string;

  @IsOptional()
  @IsString()
  @Length(0, 256)
  password?: string;

  @IsOptional()
  @IsBoolean()
  sslEnabled?: boolean;
}

export class ExecuteQueryDto {
  @IsString()
  @Length(1, 100_000)
  query: string;
}
