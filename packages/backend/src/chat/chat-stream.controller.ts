import {
  Controller,
  Header,
  MessageEvent,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Observable, interval } from 'rxjs';
import { AuthenticatedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChatHub } from './chat-hub';
import { chatStream } from './chat-stream';

/** Below the usual 30–60s proxy idle timeout. */
const HEARTBEAT_INTERVAL_MS = 25_000;

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatStreamController {
  constructor(private readonly hub: ChatHub) {}

  /**
   * One stream per user across every workspace they belong to; `ChatHub`
   * decides which events reach them by channel membership. Ids only — see
   * `chatStream`.
   */
  @Sse('stream')
  @SkipThrottle()
  @Header('X-Accel-Buffering', 'no')
  stream(@Req() req: AuthenticatedRequest): Observable<MessageEvent> {
    return chatStream({
      hub: this.hub.subscribe(Number(req.user.id)),
      heartbeat: interval(HEARTBEAT_INTERVAL_MS),
    });
  }
}
