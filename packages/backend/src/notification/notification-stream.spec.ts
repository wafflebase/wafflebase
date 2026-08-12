import { Subject, firstValueFrom, of, toArray } from 'rxjs';
import { NotificationSummary } from './notification-hub';
import { StreamEvent, notificationStream } from './notification-stream';

const A: NotificationSummary = { unreadCount: 1, latestId: 'n1' };
const B: NotificationSummary = { unreadCount: 2, latestId: 'n2' };

/** Drive the stream with hand-fed sources and record what a client sees. */
function harness(initial: NotificationSummary = A) {
  const hub = new Subject<NotificationSummary>();
  const poll = new Subject<NotificationSummary>();
  const heartbeat = new Subject<void>();
  const seen: StreamEvent[] = [];
  const sub = notificationStream({
    initial: of(initial),
    hub,
    poll,
    heartbeat,
  }).subscribe((e) => seen.push(e));
  return { hub, poll, heartbeat, seen, stop: () => sub.unsubscribe() };
}

describe('notificationStream', () => {
  it('sends the current summary as soon as a client connects', () => {
    const h = harness(A);

    expect(h.seen).toEqual([{ type: 'summary', data: A }]);
  });

  it('forwards a summary published on this replica', () => {
    const h = harness(A);

    h.hub.next(B);

    expect(h.seen).toEqual([
      { type: 'summary', data: A },
      { type: 'summary', data: B },
    ]);
  });

  it('forwards a summary discovered by the poll fallback', () => {
    const h = harness(A);

    h.poll.next(B);

    expect(h.seen[1]).toEqual({ type: 'summary', data: B });
  });

  it('suppresses a poll tick that found nothing new', () => {
    const h = harness(A);

    h.poll.next({ ...A });
    h.poll.next({ ...A });

    expect(h.seen).toHaveLength(1);
  });

  it('re-emits once the suppressed value actually changes', () => {
    const h = harness(A);

    h.poll.next({ ...A });
    h.poll.next(B);

    expect(h.seen).toEqual([
      { type: 'summary', data: A },
      { type: 'summary', data: B },
    ]);
  });

  it('emits a ping that carries no summary, so idle proxies keep the connection', () => {
    const h = harness(A);

    h.heartbeat.next();

    expect(h.seen[1]).toEqual({ type: 'ping', data: '' });
  });

  it('does not let a ping reset change detection', () => {
    const h = harness(A);

    h.heartbeat.next();
    h.poll.next({ ...A });

    expect(h.seen.filter((e) => e.type === 'summary')).toHaveLength(1);
  });

  it('completes when its sources complete', async () => {
    const hub = new Subject<NotificationSummary>();
    const poll = new Subject<NotificationSummary>();
    const heartbeat = new Subject<void>();
    const done = firstValueFrom(
      notificationStream({ initial: of(A), hub, poll, heartbeat }).pipe(
        toArray(),
      ),
    );

    hub.complete();
    poll.complete();
    heartbeat.complete();

    expect(await done).toEqual([{ type: 'summary', data: A }]);
  });
});
