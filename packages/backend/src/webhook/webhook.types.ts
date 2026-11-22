/**
 * The wire vocabulary of workspace webhooks: event types, the envelope, and
 * the shapes `data` carries. See `docs/design/webhooks.md` § Payload.
 *
 * Payload keys are snake_case because they are what a receiver reads; every
 * other type in this module is camelCase like the rest of the backend.
 */

/** Every event type a webhook can subscribe to, in picker order. */
export const WEBHOOK_EVENT_TYPES = [
  'document.created',
  'document.renamed',
  'document.moved',
  'document.trashed',
  'document.restored',
  'document.deleted',
  'document.content_updated',
  'folder.created',
  'folder.updated',
  'folder.deleted',
  'member.joined',
  'member.removed',
  'webhook.test',
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/**
 * The types a webhook may list in `events`. `webhook.test` is sent on demand
 * to one webhook, never fanned out, so subscribing to it means nothing.
 */
export const SUBSCRIBABLE_EVENT_TYPES = WEBHOOK_EVENT_TYPES.filter(
  (t): t is Exclude<WebhookEventType, 'webhook.test'> => t !== 'webhook.test',
);

export function isWebhookEventType(value: unknown): value is WebhookEventType {
  return (
    typeof value === 'string' &&
    (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value)
  );
}

export const WEBHOOK_STATUSES = ['active', 'disabled'] as const;
export type WebhookStatus = (typeof WEBHOOK_STATUSES)[number];

export const WEBHOOK_DISABLED_REASONS = [
  'failing',
  'gone',
  'creator_removed',
  'manual',
] as const;
export type WebhookDisabledReason = (typeof WEBHOOK_DISABLED_REASONS)[number];

export const DELIVERY_STATUSES = [
  'pending',
  'in_flight',
  'delivered',
  'failed',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const WEBHOOK_FORMATS = ['standard'] as const;
export type WebhookFormat = (typeof WEBHOOK_FORMATS)[number];

/** Who did it. Null for Yorkie-originated events, which carry no actor. */
export interface Actor {
  id: number;
  username: string;
}

/** The body POSTed to the endpoint (Standard Webhooks envelope). */
export interface WebhookEnvelope {
  type: WebhookEventType;
  /** ISO 8601, when the event happened. */
  timestamp: string;
  data: Record<string, unknown>;
}

/** Fields every `data` carries. */
export interface CommonEventData {
  workspace_id: string;
  actor: Actor | null;
}

export interface FolderRef {
  id: string;
  name: string;
}

/** A document as payloads describe it. `folder` is null at the root. */
export interface DocumentPayload {
  id: string;
  type: string;
  title: string;
  folder: FolderRef | null;
}

/**
 * `data` of every `document.*` event. `url` and `api_url` are omitted when
 * the deployment's origins are not configured, rather than sent wrong.
 */
export interface DocumentEventData extends CommonEventData {
  document: DocumentPayload;
  url?: string;
  api_url?: string;
}

export const DOCUMENT_SOURCE_KINDS = [
  'blank',
  'copy',
  'template',
  'upload',
  'import',
] as const;
export type DocumentSourceKind = (typeof DOCUMENT_SOURCE_KINDS)[number];

/** What a new document was made from. `id` is the source document/listing. */
export interface DocumentSource {
  kind: DocumentSourceKind;
  id?: string;
}

export interface DocumentCreatedData extends DocumentEventData {
  source: DocumentSource;
}

/**
 * A cross-workspace move adds both workspace ids and is emitted to both
 * workspaces' webhooks.
 */
export interface DocumentMovedData extends DocumentEventData {
  from_folder: FolderRef | null;
  to_folder: FolderRef | null;
  from_workspace_id?: string;
  to_workspace_id?: string;
}

/** One `/api/v1` content write inside a coalescing window (loop guard). */
export interface ApiWriter {
  api_key_id: string;
  user_id: number;
  /** ISO 8601. */
  at: string;
}

export interface DocumentContentUpdatedData extends DocumentEventData {
  /** ISO 8601: the content may have changed since this instant. */
  window_start: string;
  /** ISO 8601: the last change seen in the window. */
  updated_at: string;
  api_writers: ApiWriter[];
}

export interface FolderPayload {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface FolderEventData extends CommonEventData {
  folder: FolderPayload;
}

/**
 * Member events are fat by necessity: `/api/v1` has no members endpoint to
 * fetch from. `kind` becomes `'bot'` once chat bots exist.
 */
export interface MemberPayload {
  id: number;
  username: string;
  email: string;
  role: string;
  kind: 'user';
}

export interface MemberEventData extends CommonEventData {
  member: MemberPayload;
}

/** Visibility of the thing an event is about. Restricted never leaves. */
export type EventVisibility = 'public' | 'restricted';
