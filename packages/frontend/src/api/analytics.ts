import { fetchWithAuth } from "./auth";
import { assertOk } from "./http-error";

const VISITOR_KEY = "wb_visitor_id";

export type ViewEventType = "open" | "heartbeat" | "tabchange" | "close";

export interface DocumentAnalytics {
  enabled: boolean;
  totalViews: number;
  uniqueVisitors: number;
  returningVisitors: number;
  avgDwellSeconds: number;
  viewsByDay: { date: string; value: number }[];
  byShareLink: { shareLinkId: string; views: number; uniqueVisitors: number }[];
  byTarget: { target: string; views: number }[];
}

/**
 * Opaque random id. `crypto.randomUUID` only exists in secure contexts
 * (HTTPS/localhost); fall back so analytics never throws on plain-HTTP LAN
 * testing.
 */
function randomId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Stable, opaque, per-browser id for returning-visitor counting (not PII). */
export function getVisitorId(): string {
  // localStorage access throws (SecurityError) when cookies are disabled or in
  // strict private-browsing modes; degrade to a per-call id rather than crash.
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return randomId();
  }
}

/** Fresh id per visit; groups events for dwell-time computation. */
export function newSessionId(): string {
  return randomId();
}

interface SendInput {
  shareToken: string;
  sessionId: string;
  visitorId: string;
  eventType: ViewEventType;
  target?: string;
  /** Use sendBeacon on unload so the request survives page teardown. */
  beacon?: boolean;
}

const endpoint = () =>
  `${import.meta.env.VITE_BACKEND_API_URL}/internal/analytics/view-events`;

/** Fire-and-forget; never throws into the render path. */
export function sendViewEvents(input: SendInput): void {
  const payload = JSON.stringify({
    shareToken: input.shareToken,
    events: [
      {
        sessionId: input.sessionId,
        visitorId: input.visitorId,
        eventType: input.eventType,
        target: input.target,
      },
    ],
  });
  // Send as text/plain: a CORS-safelisted content type, so both sendBeacon and
  // keepalive fetch skip the cross-origin preflight (which sendBeacon cannot
  // perform and which would otherwise reject the request). The backend parses
  // the string body as JSON.
  try {
    if (input.beacon && navigator.sendBeacon) {
      const queued = navigator.sendBeacon(
        endpoint(),
        new Blob([payload], { type: "text/plain" }),
      );
      // sendBeacon returns false when the browser refused to queue the beacon
      // (e.g. queue full); fall through to fetch in that case.
      if (queued) return;
    }
    void fetch(endpoint(), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "text/plain" },
      body: payload,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // analytics must never break a view
  }
}

export async function getDocumentAnalytics(
  documentId: string,
  range?: { from?: string; to?: string },
): Promise<DocumentAnalytics> {
  const qs = new URLSearchParams();
  if (range?.from) qs.set("from", range.from);
  if (range?.to) qs.set("to", range.to);
  const suffix = qs.toString() ? `?${qs}` : "";
  const res = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/documents/${documentId}/analytics${suffix}`,
  );
  await assertOk(res, "Failed to load analytics");
  return res.json();
}
