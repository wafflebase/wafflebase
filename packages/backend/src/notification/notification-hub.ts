import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

/**
 * What travels over the SSE stream. Deliberately *not* the notification
 * itself: the client refreshes its badge from this and fetches the list only
 * when the dropdown opens, so a dropped event costs a stale badge that
 * self-corrects, and no notification content rides the long-lived connection.
 */
export interface NotificationSummary {
  unreadCount: number;
  latestId: string | null;
}

/**
 * In-process fan-out from notification creation to the SSE handlers of the
 * same replica. A notification created on *another* replica is picked up by
 * the controller's periodic database re-check instead — see
 * `docs/design/notifications.md`.
 */
@Injectable()
export class NotificationHub {
  private readonly subscribers = new Map<
    number,
    Set<Subject<NotificationSummary>>
  >();

  /**
   * Stream of summaries for one user. Unsubscribing removes the subject, and
   * the user's entry disappears with its last connection so the map does not
   * grow with every session.
   */
  subscribe(userId: number): Observable<NotificationSummary> {
    // Registration happens on *subscribe*, not on this call. An Observable
    // that is created and never subscribed (Nest skips the handler when the
    // response has already ended) must not leave an entry behind, and each
    // subscription gets its own subject so one teardown cannot deregister
    // another still-live one.
    return new Observable<NotificationSummary>((observer) => {
      const subject = new Subject<NotificationSummary>();
      const existing = this.subscribers.get(userId);
      if (existing) {
        existing.add(subject);
      } else {
        this.subscribers.set(userId, new Set([subject]));
      }

      const sub = subject.subscribe(observer);
      return () => {
        sub.unsubscribe();
        const set = this.subscribers.get(userId);
        if (!set) return;
        set.delete(subject);
        if (set.size === 0) this.subscribers.delete(userId);
      };
    });
  }

  /** Deliver to this user's connections on this replica. */
  publish(userId: number, summary: NotificationSummary): void {
    const set = this.subscribers.get(userId);
    if (!set) return;
    for (const subject of set) {
      subject.next(summary);
    }
  }

  /** Open connections for a user on this replica. Exposed for tests. */
  subscriberCount(userId: number): number {
    return this.subscribers.get(userId)?.size ?? 0;
  }
}
