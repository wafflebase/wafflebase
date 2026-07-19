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
  // Enriched by the controller from Postgres (`ShareLink` has no `name`
  // column, so links are labelled by role/creator/date). Absent when the link
  // has since been deleted — the dashboard falls back to the raw id.
  role?: string;
  createdAt?: string; // ISO 8601
  creator?: string; // creator username
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

/** One document's roll-up within a workspace analytics view. `title` is filled
 * by the controller from Postgres; the warehouse only knows `documentId`. */
export interface DocumentBreakdown {
  documentId: string;
  title: string;
  views: number;
  uniqueVisitors: number;
}

export interface WorkspaceAnalytics {
  enabled: boolean;
  totalViews: number;
  uniqueVisitors: number;
  viewsByDay: MetricSeriesPoint[];
  byDocument: DocumentBreakdown[];
}
