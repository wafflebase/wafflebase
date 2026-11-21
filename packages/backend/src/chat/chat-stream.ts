import { MessageEvent } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { ChatBusEvent, StreamMessageEvent } from './chat.types';

export interface ChatStreamSources {
  /** This user's message events, from `ChatHub.subscribe`. */
  hub: Observable<Extract<ChatBusEvent, { t: 'msg' }>>;
  /** Keep-alive ticks. */
  heartbeat: Observable<unknown>;
}

/**
 * Compose one client's chat SSE stream.
 *
 * `ready` goes first, on every (re)connect: it is the client's cue to
 * re-read unread counts and fetch the open channel after its last seen seq,
 * which is how a dropped connection or a missed NOTIFY self-corrects.
 * `message` carries ids only — the client fetches what it shows. `ping`
 * exists only so an idle connection keeps flowing through proxies; Nest's
 * SSE writer has no comment lines, so it is an event the client ignores.
 */
export function chatStream(
  sources: ChatStreamSources,
): Observable<MessageEvent> {
  const messages = sources.hub.pipe(
    map((e): MessageEvent => {
      const data: StreamMessageEvent = {
        workspaceId: e.w,
        channelId: e.c,
        seq: e.s,
        threadRootId: e.r,
        authorId: e.a,
      };
      return { type: 'message', data };
    }),
  );
  const pings = sources.heartbeat.pipe(
    map((): MessageEvent => ({ type: 'ping', data: '' })),
  );

  return new Observable<MessageEvent>((observer) => {
    observer.next({ type: 'ready', data: {} });
    const messageSub = messages.subscribe({
      next: (event) => observer.next(event),
      error: (err) => observer.error(err),
      complete: () => observer.complete(),
    });
    const pingSub = pings.subscribe({
      next: (event) => observer.next(event),
      error: (err) => observer.error(err),
    });
    return () => {
      messageSub.unsubscribe();
      pingSub.unsubscribe();
    };
  });
}
