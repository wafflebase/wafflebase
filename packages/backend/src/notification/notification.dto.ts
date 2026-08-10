import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsISO8601,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/** Comment event types a client may report. */
export const COMMENT_NOTIFICATION_TYPES = [
  'comment_mention',
  'comment_reply',
  'thread_resolved',
] as const;
export type CommentNotificationType =
  (typeof COMMENT_NOTIFICATION_TYPES)[number];

/**
 * A comment event as reported by the client. Comments live in Yorkie CRDT
 * documents, so the client is the only party that observes them; the service
 * decides who may actually be notified.
 *
 * `ArrayMaxSize` is generous relative to the service's own cap so an
 * over-eager client gets a 400 rather than silent truncation, while the
 * service still refuses to fan out further than `MAX_RECIPIENTS`.
 */
export class CommentNotificationDto {
  @IsIn(COMMENT_NOTIFICATION_TYPES, {
    message: `type must be one of: ${COMMENT_NOTIFICATION_TYPES.join(', ')}`,
  })
  type!: CommentNotificationType;

  @IsString()
  documentId!: string;

  @IsString()
  @MaxLength(200)
  threadId!: string;

  /**
   * Required for `comment_mention` and `comment_reply`: it is what keys their
   * dedupe. Without it the key would fall back to something every comment in
   * the thread shares, so the recipient would be notified once and then never
   * again for that thread. Absent for `thread_resolved`, which has no comment
   * of its own and keys on the thread deliberately.
   */
  @ValidateIf((dto: CommentNotificationDto) => dto.type !== 'thread_resolved')
  @IsString()
  @MaxLength(200)
  commentId?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  recipientUserIds!: number[];

  /** Truncated and stripped of control characters before storage. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  preview?: string;
}

/**
 * Cursor for the next page. It is a `(createdAt, id)` pair, not a timestamp
 * alone: one report inserts its whole batch at a single `createdAt`, so a
 * timestamp-only cursor would jump past every row that shares the boundary.
 */
export class ListNotificationsQueryDto {
  /**
   * Return notifications older than this instant, as ISO 8601.
   *
   * Kept a string and checked with `@IsISO8601` rather than converted by
   * `@Type(() => Date)`: the conversion runs *before* validation, so `@IsDate`
   * would only see whether a `Date` came out — and `new Date("August 10,
   * 2026")` parses fine. The controller builds the `Date`.
   */
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'before must be an ISO 8601 date' })
  before?: string;

  /**
   * Tiebreak within `before`: rows at exactly that instant are returned only
   * if they sort after this id. Meaningless without `before`, which the
   * controller rejects rather than silently ignoring.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  beforeId?: string;
}

export class MarkReadDto {
  /** Omit to mark every unread notification read. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  ids?: string[];
}
