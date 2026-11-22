import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  MAX_PAYLOAD_BYTES,
  WEBHOOK_NOTIFY_CHANNEL,
  type WebhookConfig,
} from './webhook-config';
import {
  documentEventData,
  folderEventData,
  memberEventData,
  toFolderRef,
} from './webhook-payload';
import type {
  Actor,
  EventVisibility,
  FolderRef,
  WebhookEnvelope,
  WebhookEventType,
} from './webhook.types';

export const WEBHOOK_CONFIG = Symbol('WEBHOOK_CONFIG');

/**
 * Who did it: a resolved actor, a user id that {@link WebhookEventService.emit}
 * resolves to one (only when some webhook will receive the event, so an
 * emitter never pays a user lookup for nothing), or `null` for no actor.
 */
export type ActorInput = Actor | number | null;

export interface EmitInput {
  workspaceId: string;
  type: WebhookEventType;
  actor: ActorInput;
  /** Merged into `data` after `workspace_id` and `actor`. */
  data: Record<string, unknown>;
  /** Set for document events; filters on `Webhook.documentTypes`. */
  documentType?: string;
  /**
   * Set for document events; filters on `Webhook.folderIds`. `null` is the
   * workspace root, `undefined` skips the folder filter. A list matches when
   * any entry does — a move within one workspace is about the folder it left
   * and the one it entered.
   */
  folderId?: string | null | ReadonlyArray<string | null>;
  /** `restricted` is never delivered to a workspace webhook. */
  visibility?: EventVisibility;
}

/** The document columns a document event describes. */
export interface DocumentEventRow {
  id: string;
  type: string;
  title: string;
  workspaceId: string;
  folderId: string | null;
}

export interface DocumentEventInput {
  type: WebhookEventType;
  actor: ActorInput;
  document: DocumentEventRow;
  /** Fields added after `document` / `url` / `api_url` (`source`, …). */
  extra?: Record<string, unknown>;
  /**
   * Whose webhooks receive it. Defaults to the document's workspace; a
   * cross-workspace move names the source workspace for its first half.
   */
  workspaceId?: string;
  /**
   * The folder(s) the `folderIds` filter is matched against. Defaults to the
   * document's folder; a move passes the folder it left as well.
   */
  filterFolderId?: EmitInput['folderId'];
  /** The document's folder, when the caller already has it. */
  folder?: FolderRef | null;
}

/** One `/api/v1` write, recorded for the `content_updated` loop guard. */
export interface ApiWriterIdentity {
  apiKeyId: string;
  userId: number;
}

/** The filter columns of a webhook, as {@link webhookMatches} reads them. */
export interface WebhookFilter {
  events: string[];
  documentTypes: string[];
  folderIds: string[];
}

/**
 * Whether a webhook subscribes to an event. Every filter is "empty = all";
 * the document filters apply only to events that carry a document, and a
 * root document (`folderId: null`) matches only an unfiltered webhook.
 */
export function webhookMatches(
  hook: WebhookFilter,
  input: Pick<EmitInput, 'type' | 'documentType' | 'folderId'>,
): boolean {
  if (hook.events.length > 0 && !hook.events.includes(input.type)) {
    return false;
  }
  if (
    input.documentType !== undefined &&
    hook.documentTypes.length > 0 &&
    !hook.documentTypes.includes(input.documentType)
  ) {
    return false;
  }
  if (input.folderId !== undefined && hook.folderIds.length > 0) {
    const candidates: ReadonlyArray<string | null> = Array.isArray(
      input.folderId,
    )
      ? input.folderId
      : [input.folderId as string | null];
    if (!candidates.some((id) => id !== null && hook.folderIds.includes(id))) {
      return false;
    }
  }
  return true;
}

/**
 * Run a domain write so that what it emits commits with it: in an
 * interactive transaction while webhooks are enabled, straight on the client
 * otherwise — so a deployment without webhooks pays no extra round trips and
 * keeps exactly the statements it ran before.
 */
export function writeWithEvents<T>(
  prisma: PrismaService,
  events: WebhookEventService | undefined,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!events?.enabled) return fn(prisma);
  return prisma.$transaction((tx) => fn(tx));
}

/**
 * The **only** emission entry point. Inserts one `WebhookDelivery` per
 * matching active webhook inside the caller's transaction (transactional
 * outbox), then `pg_notify('webhook', workspaceId)`, which Postgres delivers
 * on commit. Callers without a transaction wrap the call in
 * `prisma.$transaction(async (tx) => …)`.
 *
 * Emission lives in the domain services, never in controllers: the web
 * routes and `/api/v1` are parallel controllers over the same services, and
 * emitting from one of them is how the other ends up silent.
 */
@Injectable()
export class WebhookEventService {
  private readonly logger = new Logger(WebhookEventService.name);

  constructor(
    @Inject(WEBHOOK_CONFIG) private readonly config: WebhookConfig,
    private readonly prisma: PrismaService,
  ) {}

  get enabled(): boolean {
    return this.config.enabled;
  }

  async emit(tx: Prisma.TransactionClient, input: EmitInput): Promise<void> {
    if (!this.config.enabled) return;
    // One rule for what a workspace webhook may see, rather than one per
    // emitter: something only some members can read never leaves.
    if (input.visibility === 'restricted') return;
    // `webhook.test` goes to one webhook through the worker, never fanned out.
    if (input.type === 'webhook.test') return;

    const hooks = await tx.webhook.findMany({
      where: { workspaceId: input.workspaceId, status: 'active' },
      select: { id: true, events: true, documentTypes: true, folderIds: true },
    });
    const matching = hooks.filter((hook) => webhookMatches(hook, input));
    if (matching.length === 0) return;

    const envelope: WebhookEnvelope = {
      type: input.type,
      timestamp: new Date().toISOString(),
      data: {
        workspace_id: input.workspaceId,
        actor: await this.resolveActor(tx, input.actor),
        ...input.data,
      },
    };
    // Payloads are thin by design, so only an absurd title gets here. Refused
    // rather than truncated — a receiver would act on a half payload — and
    // never thrown: a webhook must not be able to fail the write it reports.
    const size = Buffer.byteLength(JSON.stringify(envelope.data), 'utf8');
    if (size > MAX_PAYLOAD_BYTES) {
      this.logger.warn(
        `dropping ${input.type} for workspace=${input.workspaceId}: data is ${size} bytes`,
      );
      return;
    }

    await tx.webhookDelivery.createMany({
      data: matching.map((hook) => ({
        webhookId: hook.id,
        eventType: input.type,
        payload: envelope as unknown as Prisma.InputJsonValue,
        status: 'pending',
        nextAttemptAt: new Date(),
      })),
    });
    // Held by Postgres until the transaction commits, and dropped with it on
    // rollback — so the worker is never woken for a row that does not exist.
    await tx.$executeRaw`SELECT pg_notify(${WEBHOOK_NOTIFY_CHANNEL}, ${input.workspaceId})`;
  }

  /**
   * A `document.*` event, described the one way every emitter describes a
   * document. Looks the folder up in `tx` unless the caller passes it.
   */
  async emitDocumentEvent(
    tx: Prisma.TransactionClient,
    input: DocumentEventInput,
  ): Promise<void> {
    if (!this.config.enabled) return;
    const folder =
      input.folder !== undefined
        ? input.folder
        : await this.folderRef(tx, input.document.folderId);
    await this.emit(tx, {
      workspaceId: input.workspaceId ?? input.document.workspaceId,
      type: input.type,
      actor: input.actor,
      data: {
        ...documentEventData(this.config, input.document, folder),
        ...input.extra,
      },
      documentType: input.document.type,
      folderId:
        input.filterFolderId !== undefined
          ? input.filterFolderId
          : input.document.folderId,
    });
  }

  /** A `folder.*` event. Folder events are not narrowed by the document filters. */
  async emitFolderEvent(
    tx: Prisma.TransactionClient,
    input: {
      type: 'folder.created' | 'folder.updated' | 'folder.deleted';
      actor: ActorInput;
      folder: {
        id: string;
        name: string;
        parentId: string | null;
        workspaceId: string;
      };
    },
  ): Promise<void> {
    await this.emit(tx, {
      workspaceId: input.folder.workspaceId,
      type: input.type,
      actor: input.actor,
      data: folderEventData(input.folder),
    });
  }

  /** A `member.*` event; loads the member's user row in `tx`. */
  async emitMemberEvent(
    tx: Prisma.TransactionClient,
    input: {
      type: 'member.joined' | 'member.removed';
      workspaceId: string;
      actor: ActorInput;
      userId: number;
      role: string;
    },
  ): Promise<void> {
    if (!this.config.enabled) return;
    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { id: true, username: true, email: true },
    });
    if (!user) return;
    await this.emit(tx, {
      workspaceId: input.workspaceId,
      type: input.type,
      actor: input.actor,
      data: memberEventData(user, input.role),
    });
  }

  /** `{ id, name }` of a folder, or `null` at the root (or once it is gone). */
  async folderRef(
    tx: Prisma.TransactionClient,
    folderId: string | null,
  ): Promise<FolderRef | null> {
    if (!folderId) return null;
    const folder = await tx.folder.findUnique({
      where: { id: folderId },
      select: { id: true, name: true },
    });
    return toFolderRef(folder);
  }

  /**
   * `document.content_updated` intake, from the Yorkie `DocumentRootChanged`
   * webhook. Only opens or extends the document's coalescing window — the
   * worker turns it into an event once quiet — so it costs one statement and
   * never waits on anything outbound.
   *
   * A trashed document, or one whose workspace has no active webhook that
   * subscribes to `content_updated`, writes no row: nothing would ever be
   * delivered from it, and a busy deployment without webhooks must not grow
   * a table of pending windows.
   */
  async noteContentChange(documentId: string, at: Date): Promise<void> {
    if (!this.config.enabled) return;
    const ts = utcTimestamp(at);
    await this.prisma.$executeRaw`
      INSERT INTO "WebhookContentPending"
        ("documentId", "workspaceId", "firstSeenAt", "lastIssuedAt", "apiWriters")
      SELECT d."id", d."workspaceId", ${ts}, ${ts}, '[]'::jsonb
      FROM "Document" d
      WHERE d."id" = ${documentId}
        AND d."deletedAt" IS NULL
        AND ${subscribedToContent()}
      ON CONFLICT ("documentId") DO UPDATE
        SET "lastIssuedAt" = GREATEST(
          "WebhookContentPending"."lastIssuedAt",
          EXCLUDED."lastIssuedAt"
        )`;
  }

  /**
   * Record an `/api/v1` content write in the document's window, before it is
   * pushed to Yorkie, so the `content_updated` it causes names the key that
   * caused it (the loop guard: an integration can skip its own writes). Opens
   * the window when the Yorkie event has not arrived yet.
   *
   * One entry per API key, keeping the latest write, so a key hammering one
   * document cannot grow the payload past its cap.
   */
  async noteApiWrite(
    documentId: string,
    writer: ApiWriterIdentity,
    at: Date = new Date(),
  ): Promise<void> {
    if (!this.config.enabled) return;
    const entry = JSON.stringify([
      {
        api_key_id: writer.apiKeyId,
        user_id: writer.userId,
        at: at.toISOString(),
      },
    ]);
    const ts = utcTimestamp(at);
    await this.prisma.$executeRaw`
      INSERT INTO "WebhookContentPending"
        ("documentId", "workspaceId", "firstSeenAt", "lastIssuedAt", "apiWriters")
      SELECT d."id", d."workspaceId", ${ts}, ${ts}, ${entry}::jsonb
      FROM "Document" d
      WHERE d."id" = ${documentId}
        AND d."deletedAt" IS NULL
        AND ${subscribedToContent()}
      ON CONFLICT ("documentId") DO UPDATE
        SET "apiWriters" = (
          SELECT COALESCE(jsonb_agg(w ORDER BY w->>'at'), '[]'::jsonb)
          FROM (
            SELECT DISTINCT ON (w->>'api_key_id') w
            FROM jsonb_array_elements(
              "WebhookContentPending"."apiWriters" || EXCLUDED."apiWriters"
            ) AS w
            ORDER BY w->>'api_key_id', w->>'at' DESC
          ) AS latest
        )`;
  }

  private async resolveActor(
    tx: Prisma.TransactionClient,
    actor: ActorInput,
  ): Promise<Actor | null> {
    if (actor === null) return null;
    if (typeof actor !== 'number') return actor;
    const user = await tx.user.findUnique({
      where: { id: actor },
      select: { id: true, username: true },
    });
    return user ? { id: user.id, username: user.username } : null;
  }
}

/**
 * `at` as the `timestamp(3)` (UTC wall time, no zone) Prisma stores
 * `DateTime` columns as. Spelled out because a raw query's `Date` parameter
 * would otherwise be converted through the session time zone.
 */
function utcTimestamp(at: Date): Prisma.Sql {
  return Prisma.sql`(${at.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

/**
 * The `EXISTS` both intake statements share: the document's workspace has an
 * active webhook that would receive `content_updated` (events empty = all).
 */
function subscribedToContent(): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "Webhook" w
    WHERE w."workspaceId" = d."workspaceId"
      AND w."status" = 'active'
      AND (
        cardinality(w."events") = 0
        OR 'document.content_updated' = ANY(w."events")
      )
  )`;
}
