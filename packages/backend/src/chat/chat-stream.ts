import { MessageEvent } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import {
  ChatHubEvent,
  StreamChannelEvent,
  StreamMessageEvent,
  StreamUpdateEvent,
} from './chat.types';

export interface ChatStreamSources {
  /** This user's message, update and resync events, from `ChatHub.subscribe`. */
  hub: Observable<ChatHubEvent>;
  /** Keep-alive ticks. */
  heartbeat: Observable<unknown>;
}

/**
 * Compose one client's chat SSE stream.
 *
 * `ready` goes first, on every (re)connect: it is the client's cue to
 * re-read unread counts and refetch what it has open, which is how a dropped
 * connection self-corrects. The hub sends it again mid-stream when the bus
 * listener reconnected, since a NOTIFY sent during that outage never arrived.
 * `message` carries ids only — the client fetches what it shows — and so
 * does `update`, an edit or delete the client refetches by id, and
 * `channel`, a rename / topic / archive change the client answers by
 * refetching its channel list. `ping`
 * exists only so an idle connection keeps flowing through proxies; Nest's
 * SSE writer has no comment lines, so it is an event the client ignores.
 */
export function chatStream(
  sources: ChatStreamSources,
): Observable<MessageEvent> {
  const messages = sources.hub.pipe(
    map((e): MessageEvent => {
      if (e.t === 'ready') return { type: 'ready', data: {} };
      if (e.t === 'upd') {
        const update: StreamUpdateEvent = {
          workspaceId: e.w,
          channelId: e.c,
          messageId: e.id,
          threadRootId: e.r,
        };
        return { type: 'update', data: update };
      }
      if (e.t === 'chn') {
        const channel: StreamChannelEvent = {
          workspaceId: e.w,
          channelId: e.c,
        };
        return { type: 'channel', data: channel };
      }
      const data: StreamMessageEvent = {
        workspaceId: e.w,
        channelId: e.c,
        seq: e.s,
        threadRootId: e.r,
        authorId: e.a,
        alsoInChannel: e.i,
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
