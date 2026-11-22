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
  /**
   * `false` leaves out `url` and `api_url` — for the source half of a
   * cross-workspace move, whose links would point into a workspace its
   * subscribers may not be able to open.
   */
  links?: boolean;
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
 * `prisma.$transaction(async (tx) => …)`; callers reporting many events in
 * one transaction take a {@link WebhookEventService.batch}.
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

  /**
   * Emission for a transaction that reports many events — a bulk trash or
   * move. See {@link WebhookEventBatch}; call `flush()` before the
   * transaction ends.
   */
  batch(tx: Prisma.TransactionClient): WebhookEventBatch {
    return new WebhookEventBatch(this.config, this.logger, tx);
  }

  async emit(tx: Prisma.TransactionClient, input: EmitInput): Promise<void> {
    if (!this.config.enabled) return;
    const batch = this.batch(tx);
    await batch.emit(input);
    await batch.flush();
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
    const batch = this.batch(tx);
    await batch.emitDocumentEvent(input);
    await batch.flush();
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

/** Delivery rows written per `createMany` at flush. */
const FLUSH_CHUNK = 1000;

type HookFilterRow = WebhookFilter & { id: string };

/**
 * The emission work of one transaction. Each workspace's active webhooks,
 * each folder and each actor are read once however many events need them,
 * and every delivery row goes out in one `createMany` (chunked) plus one
 * `pg_notify` per workspace at {@link flush} — so a bulk trash or move of a
 * thousand documents costs a handful of statements for its events rather
 * than five or six per document, which would run a large one past the
 * interactive transaction's timeout and fail it only while webhooks are on.
 * A document event whose workspace has no matching webhook costs no folder
 * or actor lookup at all.
 *
 * `WebhookEventService.emit` is a batch of one, so there is still exactly
 * one implementation of what an event becomes.
 */
export class WebhookEventBatch {
  private readonly hooks = new Map<string, Promise<HookFilterRow[]>>();
  private readonly folders = new Map<string, FolderRef | null>();
  private readonly actors = new Map<number, Promise<Actor | null>>();
  private readonly rows: Prisma.WebhookDeliveryCreateManyInput[] = [];
  private readonly workspaces = new Set<string>();

  constructor(
    private readonly config: WebhookConfig,
    private readonly logger: Logger,
    private readonly tx: Prisma.TransactionClient,
  ) {}

  async emit(input: EmitInput): Promise<void> {
    if (!this.config.enabled) return;
    // One rule for what a workspace webhook may see, rather than one per
    // emitter: something only some members can read never leaves.
    if (input.visibility === 'restricted') return;
    // `webhook.test` goes to one webhook through the worker, never fanned out.
    if (input.type === 'webhook.test') return;

    const matching = await this.matching(input.workspaceId, input);
    if (matching.length === 0) return;

    const envelope: WebhookEnvelope = {
      type: input.type,
      timestamp: new Date().toISOString(),
      data: {
        workspace_id: input.workspaceId,
        actor: await this.resolveActor(input.actor),
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

    const at = new Date();
    for (const hook of matching) {
      this.rows.push({
        webhookId: hook.id,
        eventType: input.type,
        payload: envelope as unknown as Prisma.InputJsonValue,
        status: 'pending',
        nextAttemptAt: at,
      });
    }
    this.workspaces.add(input.workspaceId);
  }

  /**
   * A `document.*` event, described the one way every emitter describes a
   * document. Looks the folder up unless the caller passes it — and only
   * once some webhook would receive the event.
   */
  async emitDocumentEvent(input: DocumentEventInput): Promise<void> {
    if (!this.config.enabled) return;
    const workspaceId = input.workspaceId ?? input.document.workspaceId;
    const filter = {
      type: input.type,
      documentType: input.document.type,
      folderId:
        input.filterFolderId !== undefined
          ? input.filterFolderId
          : input.document.folderId,
    };
    if ((await this.matching(workspaceId, filter)).length === 0) return;
    const folder =
      input.folder !== undefined
        ? input.folder
        : await this.folderRef(input.document.folderId);
    const data = documentEventData(this.config, input.document, folder);
    if (input.links === false) {
      delete data.url;
      delete data.api_url;
    }
    await this.emit({
      workspaceId,
      ...filter,
      actor: input.actor,
      data: { ...data, ...input.extra },
    });
  }

  /** `{ id, name }` of a folder, or `null` at the root (or once it is gone). */
  async folderRef(folderId: string | null): Promise<FolderRef | null> {
    if (!folderId) return null;
    if (!this.folders.has(folderId)) await this.preloadFolders([folderId]);
    return this.folders.get(folderId) ?? null;
  }

  /** Read many folders in one query ahead of the events that name them. */
  async preloadFolders(ids: ReadonlyArray<string | null>): Promise<void> {
    if (!this.config.enabled) return;
    const wanted = [
      ...new Set(ids.filter((id): id is string => !!id)),
    ].filter((id) => !this.folders.has(id));
    if (wanted.length === 0) return;
    const found = await this.tx.folder.findMany({
      where: { id: { in: wanted } },
      select: { id: true, name: true },
    });
    for (const id of wanted) this.folders.set(id, null);
    for (const folder of found) this.folders.set(folder.id, toFolderRef(folder));
  }

  /**
   * Write what the batch emitted. `pg_notify` is held by Postgres until the
   * transaction commits and dropped with it on rollback — so the worker is
   * never woken for a row that does not exist.
   */
  async flush(): Promise<void> {
    const rows = this.rows.splice(0);
    for (let i = 0; i < rows.length; i += FLUSH_CHUNK) {
      await this.tx.webhookDelivery.createMany({
        data: rows.slice(i, i + FLUSH_CHUNK),
      });
    }
    const workspaces = [...this.workspaces];
    this.workspaces.clear();
    for (const workspaceId of workspaces) {
      await this.tx
        .$executeRaw`SELECT pg_notify(${WEBHOOK_NOTIFY_CHANNEL}, ${workspaceId})`;
    }
  }

  private async matching(
    workspaceId: string,
    input: Pick<EmitInput, 'type' | 'documentType' | 'folderId'>,
  ): Promise<HookFilterRow[]> {
    let hooks = this.hooks.get(workspaceId);
    if (!hooks) {
      hooks = this.tx.webhook.findMany({
        where: { workspaceId, status: 'active' },
        select: {
          id: true,
          events: true,
          documentTypes: true,
          folderIds: true,
        },
      });
      this.hooks.set(workspaceId, hooks);
    }
    return (await hooks).filter((hook) => webhookMatches(hook, input));
  }

  private resolveActor(actor: ActorInput): Promise<Actor | null> {
    if (actor === null) return Promise.resolve(null);
    if (typeof actor !== 'number') return Promise.resolve(actor);
    let resolved = this.actors.get(actor);
    if (!resolved) {
      resolved = this.tx.user
        .findUnique({
          where: { id: actor },
          select: { id: true, username: true },
        })
        .then((user) => (user ? { id: user.id, username: user.username } : null));
      this.actors.set(actor, resolved);
    }
    return resolved;
  }
}
