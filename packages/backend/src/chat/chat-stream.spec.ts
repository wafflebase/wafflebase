import { MessageEvent } from '@nestjs/common';
import { Subject, firstValueFrom, toArray } from 'rxjs';
import { chatStream } from './chat-stream';
import { ChatRoutedEvent } from './chat.types';

type MsgEvent = ChatRoutedEvent;

/** Drive the stream with hand-fed sources and record what a client sees. */
function harness() {
  const hub = new Subject<MsgEvent>();
  const heartbeat = new Subject<void>();
  const seen: MessageEvent[] = [];
  const sub = chatStream({ hub, heartbeat }).subscribe((e) => seen.push(e));
  return { hub, heartbeat, seen, stop: () => sub.unsubscribe() };
}

describe('chatStream', () => {
  it('emits ready first', () => {
    const h = harness();

    expect(h.seen).toEqual([{ type: 'ready', data: {} }]);
  });

  it('maps hub events to message events with no body', () => {
    const h = harness();

    h.hub.next({ t: 'msg', c: 'c1', w: 'w1', s: 7, r: 'root', a: 3 });

    expect(h.seen[1]).toEqual({
      type: 'message',
      data: {
        workspaceId: 'w1',
        channelId: 'c1',
        seq: 7,
        threadRootId: 'root',
        authorId: 3,
      },
    });
  });

  it('maps an edit or delete to an update event with ids only', () => {
    const h = harness();

    h.hub.next({ t: 'upd', c: 'c1', w: 'w1', id: 'm9', r: 'root' });

    expect(h.seen[1]).toEqual({
      type: 'update',
      data: {
        workspaceId: 'w1',
        channelId: 'c1',
        messageId: 'm9',
        threadRootId: 'root',
      },
    });
  });

  it('heartbeats on the interval', () => {
    const h = harness();

    h.heartbeat.next();
    h.heartbeat.next();

    expect(h.seen.slice(1)).toEqual([
      { type: 'ping', data: '' },
      { type: 'ping', data: '' },
    ]);
  });

  it('stops forwarding after unsubscribe', () => {
    const h = harness();
    h.stop();

    h.hub.next({ t: 'msg', c: 'c1', w: 'w1', s: 1, r: null, a: null });
    h.heartbeat.next();

    expect(h.seen).toHaveLength(1);
  });

  it('completes when the hub completes', async () => {
    const hub = new Subject<MsgEvent>();
    const heartbeat = new Subject<void>();
    const done = firstValueFrom(chatStream({ hub, heartbeat }).pipe(toArray()));

    hub.complete();

    expect(await done).toEqual([{ type: 'ready', data: {} }]);
  });
});
