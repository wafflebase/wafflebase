import { fetchWithAuth } from "./auth";
import { assertOk, HttpError } from "./http-error";
import { seg } from "./url";

/**
 * Client for `workspaces/:workspaceId/webhooks` (JWT only). Types mirror
 * `packages/backend/src/webhook/webhook.dto.ts`; see
 * `docs/design/webhooks.md`.
 */

const BASE = `${import.meta.env.VITE_BACKEND_API_URL}/workspaces`;

/** Every event type a webhook can subscribe to, in picker order. */
export const WEBHOOK_EVENT_TYPES = [
  "document.created",
  "document.renamed",
  "document.moved",
  "document.trashed",
  "document.restored",
  "document.deleted",
  "document.content_updated",
  "folder.created",
  "folder.updated",
  "folder.deleted",
  "member.joined",
  "member.removed",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export type WebhookStatus = "active" | "disabled";
export type WebhookDisabledReason =
  | "failing"
  | "gone"
  | "creator_removed"
  | "manual";
export type DeliveryStatus = "pending" | "in_flight" | "delivered" | "failed";

/** `SafeOutboundError` codes, so the UI can name the env var to set. */
export type WebhookUrlErrorCode =
  | "invalid_url"
  | "scheme_not_allowed"
  | "private_address"
  | "dns_failed"
  | "redirect"
  | "timeout"
  | "too_large"
  | "network";

export interface WebhookSummary {
  id: string;
  name: string;
  /** Host only: the full URL is often itself a secret. */
  host: string;
  /** Present for owners only. */
  url?: string;
  status: WebhookStatus;
  disabledReason: WebhookDisabledReason | null;
  /** Empty = every event. */
  events: string[];
  lastDeliveryAt: string | null;
  lastDeliveryStatus: number | null;
  createdBy: { id: number; username: string } | null;
  createdAt: string;
}

export interface WebhookDetail extends WebhookSummary {
  url: string;
  /** Empty = every document type. */
  documentTypes: string[];
  /** Empty = every folder. */
  folderIds: string[];
  format: string;
  disabledAt: string | null;
  /**
   * The default "recover since" while disabled: when the oldest delivery the
   * disable stopped was created, or `disabledAt` if it stopped none.
   */
  recoverFrom: string | null;
  /** When the previous secret stops being signed with, during an overlap. */
  rotationExpiresAt: string | null;
  failingSince: string | null;
}

export interface DeliverySummary {
  id: string;
  eventType: string;
  status: DeliveryStatus;
  attempts: number;
  lastStatus: number | null;
  lastError: string | null;
  lastDurationMs: number | null;
  nextAttemptAt: string;
  deliveredAt: string | null;
  createdAt: string;
}

export interface DeliveryDetail extends DeliverySummary {
  payload: unknown;
  responseExcerpt: string | null;
}

export interface WebhookTestResult {
  ok: boolean;
  status: number | null;
  durationMs: number | null;
  error: string | null;
  errorCode: WebhookUrlErrorCode | null;
  responseExcerpt: string | null;
}

export interface WebhookList {
  /** False when the server runs without `WAFFLEBASE_WEBHOOKS_ENABLED=true`. */
  enabled: boolean;
  canManage: boolean;
  webhooks: WebhookSummary[];
}

export interface WebhookInput {
  name: string;
  url: string;
  events: string[];
  documentTypes: string[];
  folderIds: string[];
}

export interface DeliveryCursor {
  before: string;
  beforeId: string;
}

export interface DeliveryPage {
  deliveries: DeliverySummary[];
  nextCursor: DeliveryCursor | null;
}

/**
 * A URL the server refused (400 with a `code`). Carries the code and, for
 * `private_address`, the address — so the form can say *which* setting an
 * administrator would change instead of "Invalid URL".
 */
export class WebhookUrlError extends HttpError {
  readonly code: WebhookUrlErrorCode;
  readonly address?: string;
  constructor(
    message: string,
    code: WebhookUrlErrorCode,
    address?: string,
  ) {
    super(message, 400);
    this.name = "WebhookUrlError";
    this.code = code;
    this.address = address;
  }
}

/**
 * Like `assertOk`, but turns a coded 400 into a {@link WebhookUrlError}. The
 * body is read from a clone so `assertOk` can still read it otherwise.
 */
async function assertWebhookOk(res: Response, fallback: string) {
  if (res.status === 400) {
    try {
      const body = (await res.clone().json()) as {
        code?: unknown;
        message?: unknown;
        address?: unknown;
      };
      if (typeof body.code === "string") {
        throw new WebhookUrlError(
          typeof body.message === "string" ? body.message : fallback,
          body.code as WebhookUrlErrorCode,
          typeof body.address === "string" ? body.address : undefined,
        );
      }
    } catch (error) {
      if (error instanceof WebhookUrlError) throw error;
      // Not JSON or no code: fall through to the generic message.
    }
  }
  await assertOk(res, fallback);
}

function hooks(workspaceId: string): string {
  return `${BASE}/${seg(workspaceId)}/webhooks`;
}

function hook(workspaceId: string, webhookId: string): string {
  return `${hooks(workspaceId)}/${seg(webhookId)}`;
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

/** Lists a workspace's webhooks. Members get host-only rows. */
export async function fetchWebhooks(workspaceId: string): Promise<WebhookList> {
  const res = await fetchWithAuth(hooks(workspaceId));
  await assertOk(res, "Couldn't load webhooks");
  return res.json();
}

export async function fetchWebhook(
  workspaceId: string,
  webhookId: string,
): Promise<WebhookDetail> {
  const res = await fetchWithAuth(hook(workspaceId, webhookId));
  await assertOk(res, "Couldn't load the webhook");
  return res.json();
}

/**
 * Creates a webhook and sends it a test event. A failed test does not fail
 * the create: the result comes back beside the saved webhook.
 */
export async function createWebhook(
  workspaceId: string,
  input: WebhookInput,
): Promise<{ webhook: WebhookDetail; test: WebhookTestResult }> {
  const res = await fetchWithAuth(hooks(workspaceId), jsonInit("POST", input));
  await assertWebhookOk(res, "Couldn't create the webhook");
  return res.json();
}

/** Updates a webhook. `test` is non-null only when the URL changed. */
export async function updateWebhook(
  workspaceId: string,
  webhookId: string,
  input: Partial<WebhookInput>,
): Promise<{ webhook: WebhookDetail; test: WebhookTestResult | null }> {
  const res = await fetchWithAuth(
    hook(workspaceId, webhookId),
    jsonInit("PATCH", input),
  );
  await assertWebhookOk(res, "Couldn't update the webhook");
  return res.json();
}

export async function deleteWebhook(
  workspaceId: string,
  webhookId: string,
): Promise<void> {
  const res = await fetchWithAuth(hook(workspaceId, webhookId), {
    method: "DELETE",
  });
  await assertOk(res, "Couldn't delete the webhook");
}

export async function testWebhook(
  workspaceId: string,
  webhookId: string,
): Promise<WebhookTestResult> {
  const res = await fetchWithAuth(
    `${hook(workspaceId, webhookId)}/test`,
    jsonInit("POST"),
  );
  await assertOk(res, "Couldn't send the test event");
  return res.json();
}

export async function revealWebhookSecret(
  workspaceId: string,
  webhookId: string,
): Promise<{
  secret: string;
  previousSecret: string | null;
  previousExpiresAt: string | null;
}> {
  const res = await fetchWithAuth(
    `${hook(workspaceId, webhookId)}/reveal-secret`,
    jsonInit("POST"),
  );
  await assertOk(res, "Couldn't reveal the secret");
  return res.json();
}

/**
 * Rotates the signing secret. Both secrets sign during the overlap; a second
 * rotation inside it is refused with 409 (`rotation_in_progress`).
 */
export async function rotateWebhookSecret(
  workspaceId: string,
  webhookId: string,
  overlapHours?: number,
): Promise<{ secret: string; previousExpiresAt: string }> {
  const res = await fetchWithAuth(
    `${hook(workspaceId, webhookId)}/rotate-secret`,
    jsonInit("POST", overlapHours === undefined ? {} : { overlapHours }),
  );
  await assertOk(res, "Couldn't rotate the secret", {
    statusMessages: {
      409: "A rotation is already in progress. Wait for the previous secret to expire.",
    },
  });
  return res.json();
}

/**
 * Re-enables a webhook and records the caller as its owner. Failed
 * deliveries created at or after `recoverSince` are sent again; null sends
 * none.
 */
export async function enableWebhook(
  workspaceId: string,
  webhookId: string,
  recoverSince: string | null,
): Promise<WebhookDetail> {
  const res = await fetchWithAuth(
    `${hook(workspaceId, webhookId)}/enable`,
    jsonInit("POST", { recoverSince }),
  );
  await assertOk(res, "Couldn't turn the webhook on");
  return res.json();
}

export async function disableWebhook(
  workspaceId: string,
  webhookId: string,
): Promise<WebhookDetail> {
  const res = await fetchWithAuth(
    `${hook(workspaceId, webhookId)}/disable`,
    jsonInit("POST"),
  );
  await assertOk(res, "Couldn't turn the webhook off");
  return res.json();
}

export async function fetchWebhookDeliveries(
  workspaceId: string,
  webhookId: string,
  options: {
    status?: "failed" | "all";
    cursor?: DeliveryCursor | null;
    limit?: number;
  } = {},
): Promise<DeliveryPage> {
  const params = new URLSearchParams();
  if (options.status) params.set("status", options.status);
  if (options.cursor) {
    params.set("before", options.cursor.before);
    params.set("beforeId", options.cursor.beforeId);
  }
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  const qs = params.toString();
  const res = await fetchWithAuth(
    `${hook(workspaceId, webhookId)}/deliveries${qs ? `?${qs}` : ""}`,
  );
  await assertOk(res, "Couldn't load deliveries");
  return res.json();
}

export async function fetchWebhookDelivery(
  workspaceId: string,
  webhookId: string,
  deliveryId: string,
): Promise<DeliveryDetail> {
  const res = await fetchWithAuth(
    `${hook(workspaceId, webhookId)}/deliveries/${seg(deliveryId)}`,
  );
  await assertOk(res, "Couldn't load the delivery");
  return res.json();
}

/** Pulls the delivery's next attempt to now. Same delivery id. */
export async function redeliverWebhookDelivery(
  workspaceId: string,
  webhookId: string,
  deliveryId: string,
): Promise<DeliverySummary> {
  const res = await fetchWithAuth(
    `${hook(workspaceId, webhookId)}/deliveries/${seg(deliveryId)}/redeliver`,
    jsonInit("POST"),
  );
  await assertOk(res, "Couldn't redeliver");
  return res.json();
}

export interface MemberRemovalImpact {
  privateChannelsDeleted: number;
  webhooksDisabled: number;
  /** Bots they own here, deleted with them; absent from older servers. */
  botsRemoved?: number;
}

/** What removing a member would delete or turn off, for the confirm dialog. */
export async function fetchMemberRemovalImpact(
  workspaceId: string,
  userId: number,
): Promise<MemberRemovalImpact> {
  const res = await fetchWithAuth(
    `${BASE}/${seg(workspaceId)}/members/${seg(String(userId))}/removal-impact`,
  );
  await assertOk(res, "Couldn't check what removing this member affects");
  return res.json();
}
