import { Observable, map, merge } from 'rxjs';
import { NotificationSummary } from './notification-hub';

/**
 * What the SSE handler writes out. `summary` updates the client's badge;
 * `ping` exists only so an idle connection keeps flowing through proxies that
 * would otherwise time it out. The client ignores `ping`.
 */
export type StreamEvent =
  | { type: 'summary'; data: NotificationSummary }
  | { type: 'ping'; data: '' };

export interface StreamSources {
  /** The summary to send the moment a client connects. */
  initial: Observable<NotificationSummary>;
  /** Notifications created on this replica — instant. */
  hub: Observable<NotificationSummary>;
  /** Periodic re-read, which is how another replica's writes arrive. */
  poll: Observable<NotificationSummary>;
  /** Keep-alive ticks. */
  heartbeat: Observable<unknown>;
}

function sameSummary(a: NotificationSummary, b: NotificationSummary): boolean {
  return a.unreadCount === b.unreadCount && a.latestId === b.latestId;
}

/**
 * Compose one client's SSE stream.
 *
 * Summaries are deduplicated against the last one *sent*, so the poll
 * fallback firing every minute on a quiet inbox produces no traffic, and a
 * notification delivered instantly by the hub is not repeated when the next
 * poll finds it. Pings bypass that check and never disturb it.
 */
export function notificationStream(
  sources: StreamSources,
): Observable<StreamEvent> {
  const summaries = merge(sources.initial, sources.hub, sources.poll);
  const pings = sources.heartbeat.pipe(
    map((): StreamEvent => ({ type: 'ping', data: '' })),
  );

  return new Observable<StreamEvent>((observer) => {
    let last: NotificationSummary | null = null;

    const summarySub = summaries.subscribe({
      next: (summary) => {
        if (last && sameSummary(last, summary)) return;
        last = summary;
        observer.next({ type: 'summary', data: summary });
      },
      error: (err) => observer.error(err),
      complete: () => observer.complete(),
    });
    const pingSub = pings.subscribe({
      next: (event) => observer.next(event),
      error: (err) => observer.error(err),
    });

    return () => {
      summarySub.unsubscribe();
      pingSub.unsubscribe();
    };
  });
}
