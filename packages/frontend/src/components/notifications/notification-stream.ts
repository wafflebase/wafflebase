/** What the SSE `summary` event carries. Mirrors the backend's shape. */
export interface NotificationSummary {
  unreadCount: number;
  latestId: string | null;
}

/**
 * Parse one `summary` event payload, returning null for anything that is not
 * a usable summary. The stream is long-lived and a bad frame must not throw
 * inside an event listener — it is simply ignored, and the next poll tick or
 * the dropdown's own fetch corrects the badge.
 */
export function parseSummaryEvent(raw: string): NotificationSummary | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const { unreadCount, latestId } = parsed as Record<string, unknown>;
  if (typeof unreadCount !== "number" || !Number.isFinite(unreadCount)) {
    return null;
  }
  if (unreadCount < 0) return null;
  if (latestId !== null && typeof latestId !== "string") return null;

  return { unreadCount, latestId };
}
