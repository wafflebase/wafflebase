import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_BODY_LENGTH } from '../chat/chat.dto';

/** The longest `agent/tasks/next` wait, in seconds. */
export const MAX_TASK_WAIT_SECONDS = 240;

/** `GET …/agent/tasks/next?wait=<seconds>`; no wait answers at once. */
export class NextTaskQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_TASK_WAIT_SECONDS)
  wait?: number;
}

/**
 * `POST …/agent/tasks/:taskId/reply`. The cap is loose like the chat post's
 * (`PostMessageDto`), so an over-long body gets the service's own 400.
 */
export class ReplyTaskDto {
  @IsString()
  @MaxLength(MAX_BODY_LENGTH * 2)
  body!: string;
}

/** `POST …/agent/tasks/:taskId/complete`. */
export class CompleteTaskDto {
  @IsIn(['done', 'failed'], { message: 'status must be one of: done, failed' })
  status!: 'done' | 'failed';
}
