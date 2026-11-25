import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/** The longest message body, after trimming. */
export const MAX_BODY_LENGTH = 4_000;
const MAX_TOPIC_LENGTH = 250;

/**
 * `POST …/chat/channels`: create a public or private channel, or open a DM.
 * A DM is a channel too, so one route covers both; `name` belongs to the
 * first two and `userIds` to the third.
 *
 * Array and string caps here are generous relative to the service's own
 * rules (2–8 DM members, the channel-name pattern) so a bad request gets the
 * service's specific 400 rather than a generic one.
 */
export class CreateChannelDto {
  @IsIn(['public', 'private', 'dm'], {
    message: 'kind must be one of: public, private, dm',
  })
  kind!: 'public' | 'private' | 'dm';

  @ValidateIf((dto: CreateChannelDto) => dto.kind !== 'dm')
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_TOPIC_LENGTH)
  topic?: string;

  @ValidateIf((dto: CreateChannelDto) => dto.kind === 'dm')
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  userIds?: number[];
}

export class UpdateChannelDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  /** An empty string clears the topic. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TOPIC_LENGTH)
  topic?: string;

  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

/** `POST …/channels/:channelId/members`: no `userIds` (or empty) = join. */
export class AddMembersDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  userIds?: number[];
}

/**
 * The body is length-checked again after trimming in the service; this cap
 * only bounds what the validator has to read.
 */
export class PostMessageDto {
  @IsString()
  @MaxLength(MAX_BODY_LENGTH * 2)
  body!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  threadRootId?: string;

  @IsOptional()
  @IsBoolean()
  alsoInChannel?: boolean;
}

export class EditMessageDto {
  @IsString()
  @MaxLength(MAX_BODY_LENGTH * 2)
  body!: string;
}

/**
 * Paging cursors are `seq` values. Query strings arrive as text, and the
 * global pipe runs without implicit conversion, so each number is converted
 * explicitly before it is validated.
 */
export class ListMessagesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  before?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  after?: number;

  /** A thread root's id: return that thread (root first) instead. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  thread?: string;
}

/**
 * `@IsInt` is `Number.isInteger`, which takes `1e20`; past the safe range
 * `BigInt(seq)` overflows the `bigint` column and Postgres answers a 500.
 */
export class MarkReadDto {
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  seq!: number;
}

/** `GET …/channels/:cid/files`. `before` is the previous page's `cursor`. */
export class ListFilesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  before?: string;
}
