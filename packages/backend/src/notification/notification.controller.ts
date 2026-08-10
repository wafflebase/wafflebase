import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  EMPTY,
  Observable,
  catchError,
  defer,
  from,
  interval,
  switchMap,
} from 'rxjs';
import { AuthenticatedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  CommentNotificationDto,
  ListNotificationsQueryDto,
  MarkReadDto,
} from './notification.dto';
import { NotificationHub } from './notification-hub';
import { StreamEvent, notificationStream } from './notification-stream';
import { NotificationService } from './notification.service';

/**
 * How often an open stream re-reads the database. This is what makes SSE
 * correct across replicas without a message bus: a notification created
 * elsewhere shows up within this window, and a client that reconnected
 * mid-gap catches up on its first tick.
 */
const POLL_INTERVAL_MS = 60_000;
/** Below the usual 30–60s proxy idle timeout. */
const HEARTBEAT_INTERVAL_MS = 25_000;

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(
    private readonly service: NotificationService,
    private readonly hub: NotificationHub,
  ) {}

  /**
   * Client report of a comment event. Throttled well below the default
   * bucket: a human posts comments at human speed, and this is the one
   * endpoint a client can call on its own initiative.
   */
  @Post('comment')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async createFromComment(
    @Req() req: AuthenticatedRequest,
    @Body() body: CommentNotificationDto,
  ): Promise<{ created: number }> {
    return this.service.createFromComment(Number(req.user.id), body);
  }

  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.service.list(Number(req.user.id), query.before);
  }

  @Get('unread-count')
  async unreadCount(
    @Req() req: AuthenticatedRequest,
  ): Promise<{ count: number }> {
    return { count: await this.service.unreadCount(Number(req.user.id)) };
  }

  @Post('read')
  @HttpCode(204)
  async markRead(
    @Req() req: AuthenticatedRequest,
    @Body() body: MarkReadDto,
  ): Promise<void> {
    await this.service.markRead(Number(req.user.id), body.ids);
  }

  /**
   * Badge stream. Carries `{ unreadCount, latestId }` only — the client
   * fetches the actual list when the dropdown opens, so a dropped event costs
   * a stale badge that self-corrects rather than a missing notification.
   */
  @Sse('stream')
  @SkipThrottle()
  @Header('X-Accel-Buffering', 'no')
  stream(@Req() req: AuthenticatedRequest): Observable<StreamEvent> {
    const userId = Number(req.user.id);
    // A transient database error must not tear down a long-lived connection:
    // swallow the tick and let the next one retry.
    const summary = () =>
      from(this.service.summaryFor(userId)).pipe(catchError(() => EMPTY));

    return notificationStream({
      initial: defer(summary),
      hub: this.hub.subscribe(userId),
      poll: interval(POLL_INTERVAL_MS).pipe(switchMap(summary)),
      heartbeat: interval(HEARTBEAT_INTERVAL_MS),
    });
  }
}
