export const VIEW_EVENT_TYPES = [
  'open',
  'heartbeat',
  'tabchange',
  'close',
] as const;
export type ViewEventType = (typeof VIEW_EVENT_TYPES)[number];

/** Raw event as sent by the browser beacon (client-supplied fields only). */
export interface ViewEventInput {
  sessionId: string;
  visitorId: string;
  eventType: ViewEventType;
  target?: string;
}

/** Enriched event produced to Kafka (server-derived fields added). */
export interface ViewEvent {
  document_id: string;
  share_link_id: string;
  session_id: string;
  visitor_id: string;
  user_id: string;
  role: string;
  event_type: ViewEventType;
  target: string;
  doc_type: string;
  user_agent: string;
  timestamp: string; // 'YYYY-MM-DD HH:MM:SS' (StarRocks DATETIME)
}

export interface MetricSeriesPoint {
  date: string; // 'YYYY-MM-DD'
  value: number;
}

export interface ShareLinkBreakdown {
  shareLinkId: string;
  views: number;
  uniqueVisitors: number;
}

export interface TargetBreakdown {
  target: string;
  views: number;
}

export interface DocumentAnalytics {
  enabled: boolean;
  totalViews: number;
  uniqueVisitors: number;
  returningVisitors: number;
  avgDwellSeconds: number;
  viewsByDay: MetricSeriesPoint[];
  byShareLink: ShareLinkBreakdown[];
  byTarget: TargetBreakdown[];
}
