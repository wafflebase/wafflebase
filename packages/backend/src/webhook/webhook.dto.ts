import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { Webhook, WebhookDelivery } from '@prisma/client';
import { DOCUMENT_TYPES } from '../document/document.dto';
import {
  MAX_ROTATION_OVERLAP_HOURS,
  MIN_ROTATION_OVERLAP_HOURS,
} from './webhook-config';
import { SUBSCRIBABLE_EVENT_TYPES } from './webhook.types';

/** URLs past this are refused; a webhook URL is not a document. */
const MAX_URL_LENGTH = 2048;
/** A workspace has far fewer folders than this worth filtering on. */
const MAX_FOLDER_FILTER = 50;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export class CreateWebhookDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  /** Checked against the SSRF rules by the service, not here. */
  @IsString()
  @Length(1, MAX_URL_LENGTH)
  url!: string;

  /** Empty = every event. */
  @IsArray()
  @ArrayUnique()
  @IsIn(SUBSCRIBABLE_EVENT_TYPES, { each: true })
  events!: string[];

  /** Empty = every document type. */
  @IsArray()
  @ArrayUnique()
  @IsIn(DOCUMENT_TYPES, { each: true })
  documentTypes!: string[];

  /** Empty = every folder. Each must be a folder of this workspace. */
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(MAX_FOLDER_FILTER)
  @IsUUID('all', { each: true })
  folderIds!: string[];
}

export class UpdateWebhookDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, MAX_URL_LENGTH)
  url?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(SUBSCRIBABLE_EVENT_TYPES, { each: true })
  events?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(DOCUMENT_TYPES, { each: true })
  documentTypes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(MAX_FOLDER_FILTER)
  @IsUUID('all', { each: true })
  folderIds?: string[];
}

export class RotateSecretDto {
  /** How long the previous secret keeps being signed with. Default 24. */
  @IsOptional()
  @IsInt()
  @Min(MIN_ROTATION_OVERLAP_HOURS)
  @Max(MAX_ROTATION_OVERLAP_HOURS)
  overlapHours?: number;
}

export class EnableWebhookDto {
  /**
   * Re-queue failed deliveries created at or after this instant. Null or
   * omitted re-queues nothing.
   */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsISO8601({ strict: true })
  recoverSince?: string | null;
}

export const DELIVERY_PAGE_SIZE = 50;

/** `(createdAt, id)` cursor, as in `ListNotificationsQueryDto`. */
export class ListDeliveriesQueryDto {
  @IsOptional()
  @IsIn(['failed', 'all'])
  status?: 'failed' | 'all';

  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'before must be an ISO 8601 date' })
  before?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  beforeId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(DELIVERY_PAGE_SIZE)
  limit?: number;
}

// ---------------------------------------------------------------------------
// Responses (mirrored in packages/frontend/src/api/webhooks.ts)
// ---------------------------------------------------------------------------

export interface WebhookSummary {
  id: string;
  name: string;
  /** Host only: the full URL is often itself a secret. */
  host: string;
  /** Present for owners only. */
  url?: string;
  status: string;
  disabledReason: string | null;
  events: string[];
  lastDeliveryAt: string | null;
  lastDeliveryStatus: number | null;
  createdBy: { id: number; username: string } | null;
  createdAt: string;
}

export interface WebhookDetail extends WebhookSummary {
  url: string;
  documentTypes: string[];
  folderIds: string[];
  format: string;
  disabledAt: string | null;
  /**
   * The default "recover since" while disabled: the creation time of the
   * oldest delivery the disable stopped, or `disabledAt` if it stopped none.
   */
  recoverFrom: string | null;
  /** When the previous secret stops being signed with, during an overlap. */
  rotationExpiresAt: string | null;
  failingSince: string | null;
}

export interface DeliverySummary {
  id: string;
  eventType: string;
  status: string;
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

export interface TestResult {
  ok: boolean;
  status: number | null;
  durationMs: number | null;
  error: string | null;
  /** A `SafeOutboundError` code, so the UI can name the env var to set. */
  errorCode: string | null;
  responseExcerpt: string | null;
}

export interface WebhookListResponse {
  enabled: boolean;
  canManage: boolean;
  webhooks: WebhookSummary[];
}

export interface DeliveryPage {
  deliveries: DeliverySummary[];
  nextCursor: { before: string; beforeId: string } | null;
}

/** A webhook row with the creator selected (`include: { creator: … }`). */
export type WebhookWithCreator = Webhook & {
  creator: { id: number; username: string } | null;
};

/** The host of a stored URL, or `''` if it no longer parses. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

/**
 * The list row. `includeUrl` is true for owners; members see the host only.
 */
export function toSummary(
  webhook: WebhookWithCreator,
  includeUrl: boolean,
): WebhookSummary {
  const summary: WebhookSummary = {
    id: webhook.id,
    name: webhook.name,
    host: hostOf(webhook.url),
    status: webhook.status,
    disabledReason: webhook.disabledReason,
    events: webhook.events,
    lastDeliveryAt: iso(webhook.lastDeliveryAt),
    lastDeliveryStatus: webhook.lastDeliveryStatus,
    createdBy: webhook.creator
      ? { id: webhook.creator.id, username: webhook.creator.username }
      : null,
    createdAt: webhook.createdAt.toISOString(),
  };
  if (includeUrl) summary.url = webhook.url;
  return summary;
}

/** The owner's detail view. Never carries a secret. */
export function toDetail(
  webhook: WebhookWithCreator,
  now: Date = new Date(),
): WebhookDetail {
  const rotating =
    webhook.prevSecretEnc !== null &&
    webhook.prevSecretExpiresAt !== null &&
    webhook.prevSecretExpiresAt > now;
  return {
    ...toSummary(webhook, true),
    url: webhook.url,
    documentTypes: webhook.documentTypes,
    folderIds: webhook.folderIds,
    format: webhook.format,
    disabledAt: iso(webhook.disabledAt),
    recoverFrom: iso(webhook.recoverFrom),
    rotationExpiresAt: rotating ? iso(webhook.prevSecretExpiresAt) : null,
    failingSince: iso(webhook.failingSince),
  };
}

export function toDeliverySummary(delivery: WebhookDelivery): DeliverySummary {
  return {
    id: delivery.id,
    eventType: delivery.eventType,
    status: delivery.status,
    attempts: delivery.attempts,
    lastStatus: delivery.lastStatus,
    lastError: delivery.lastError,
    lastDurationMs: delivery.lastDurationMs,
    nextAttemptAt: delivery.nextAttemptAt.toISOString(),
    deliveredAt: iso(delivery.deliveredAt),
    createdAt: delivery.createdAt.toISOString(),
  };
}

export function toDeliveryDetail(delivery: WebhookDelivery): DeliveryDetail {
  return {
    ...toDeliverySummary(delivery),
    payload: delivery.payload,
    responseExcerpt: delivery.responseExcerpt,
  };
}
