import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

const API_KEY_SCOPES = ['read', 'write'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export class CreateApiKeyDto {
  @IsString()
  @Length(1, 100)
  name: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ArrayUnique()
  @IsIn(API_KEY_SCOPES, { each: true })
  scopes?: ApiKeyScope[];

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
