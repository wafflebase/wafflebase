import type { Notification } from "@/api/notifications";

/** Whether marking `ids` read should affect this row. */
function targeted(n: Notification, ids: string[] | undefined): boolean {
  if (n.readAt) return false;
  return ids ? ids.includes(n.id) : true;
}

/** The cached page with the just-read rows stamped. */
export function applyRead(
  list: ReadonlyArray<Notification>,
  ids: string[] | undefined,
  readAt: string,
): Notification[] {
  return list.map((n) => (targeted(n, ids) ? { ...n, readAt } : n));
}

/**
 * The badge after marking `ids` read.
 *
 * Decrements rather than recounting the cached page: the page holds at most
 * `LIST_PAGE_SIZE` rows, so a user with more unread than fits would see the
 * badge collapse to the page's count instead of losing just the one they read.
 * Marking everything is the one case where the true answer is known outright.
 */
export function nextUnreadCount(
  previous: number | undefined,
  list: ReadonlyArray<Notification>,
  ids: string[] | undefined,
): number {
  if (!ids) return 0;
  const marked = list.filter((n) => targeted(n, ids)).length;
  return Math.max(0, (previous ?? 0) - marked);
}
