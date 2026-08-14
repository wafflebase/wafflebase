import { NotificationHub, NotificationSummary } from './notification-hub';

function collect(
  hub: NotificationHub,
  userId: number,
): { seen: NotificationSummary[]; stop: () => void } {
  const seen: NotificationSummary[] = [];
  const sub = hub.subscribe(userId).subscribe((s) => seen.push(s));
  return { seen, stop: () => sub.unsubscribe() };
}

describe('NotificationHub', () => {
  let hub: NotificationHub;

  beforeEach(() => {
    hub = new NotificationHub();
  });

  it('delivers a published summary to a subscriber of that user', () => {
    const a = collect(hub, 1);

    hub.publish(1, { unreadCount: 3, latestId: 'n1' });

    expect(a.seen).toEqual([{ unreadCount: 3, latestId: 'n1' }]);
  });

  it('does not deliver one user summary to another user', () => {
    const a = collect(hub, 1);
    const b = collect(hub, 2);

    hub.publish(2, { unreadCount: 1, latestId: 'n2' });

    expect(a.seen).toEqual([]);
    expect(b.seen).toHaveLength(1);
  });

  it('delivers to every open connection of the same user', () => {
    const tab1 = collect(hub, 1);
    const tab2 = collect(hub, 1);

    hub.publish(1, { unreadCount: 5, latestId: 'n5' });

    expect(tab1.seen).toHaveLength(1);
    expect(tab2.seen).toHaveLength(1);
  });

  it('stops delivering after unsubscribe', () => {
    const a = collect(hub, 1);
    a.stop();

    hub.publish(1, { unreadCount: 1, latestId: 'n1' });

    expect(a.seen).toEqual([]);
  });

  it('drops the user entry once its last subscriber leaves', () => {
    const tab1 = collect(hub, 1);
    const tab2 = collect(hub, 1);

    expect(hub.subscriberCount(1)).toBe(2);
    tab1.stop();
    expect(hub.subscriberCount(1)).toBe(1);
    tab2.stop();
    expect(hub.subscriberCount(1)).toBe(0);
  });

  it('publishing to a user with no subscribers is a no-op', () => {
    expect(() =>
      hub.publish(99, { unreadCount: 1, latestId: 'n1' }),
    ).not.toThrow();
  });
});
