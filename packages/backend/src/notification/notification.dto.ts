import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
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

  /** Absent for `thread_resolved`, which has no comment of its own. */
  @IsOptional()
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

export class ListNotificationsQueryDto {
  /** Cursor: return notifications older than this instant. */
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'before must be an ISO 8601 date' })
  before?: Date;
}

export class MarkReadDto {
  /** Omit to mark every unread notification read. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  ids?: string[];
}
