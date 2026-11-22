import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Document, Prisma } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { LIVE_DOCUMENT, TRASHED_DOCUMENT } from './live-document';
import {
  WebhookEventService,
  writeWithEvents,
} from '../webhook/webhook-event.service';
import type { DocumentSource } from '../webhook/webhook.types';

/**
 * Who a document write is attributed to in its webhook event: the acting
 * user's id, or `null` for a write with no person behind it.
 */
export type DocumentActor = number | null;

/**
 * What `createDocument` reports as `document.created`. `null` means the
 * caller emits the event itself, once the document is complete — the copy
 * path, whose row is rolled back if the content copy fails.
 */
export type DocumentCreatedEvent = {
  actorId: DocumentActor;
  source: DocumentSource;
} | null;

/**
 * Author fields surfaced on the documents-list rows. `select`ed (not the
 * whole User) so we never leak auth-provider internals to the client.
 */
export const documentListInclude = {
  author: { select: { id: true, username: true, photo: true } },
} satisfies Prisma.DocumentInclude;

export type DocumentWithAuthor = Prisma.DocumentGetPayload<{
  include: typeof documentListInclude;
}>;

/**
 * Document persistence. Every read here returns **live** documents only
 * (`LIVE_DOCUMENT`, see `live-document.ts`): a trashed row answers as if it
 * did not exist. The trash routes are the only callers that see trashed rows,
 * and they say so by name — {@link documentIncludingTrashed},
 * {@link trashedDocument} and {@link listTrash}.
 */
@Injectable()
export class DocumentService {
  constructor(
    private prisma: PrismaService,
    // Optional only so hand-built instances in tests keep compiling; the app
    // always provides it (`DocumentModule` imports `WebhookEventModule`).
    @Optional() private readonly webhookEvents?: WebhookEventService,
  ) {}

  /** A live document, or `null` when it is missing or in the trash. */
  async document(
    postWhereUniqueInput: Prisma.DocumentWhereUniqueInput,
  ): Promise<Document | null> {
    return this.prisma.document.findUnique({
      where: { ...postWhereUniqueInput, ...LIVE_DOCUMENT },
    });
  }

  /**
   * A document whether live or trashed. Only for the trash routes (restore,
   * and re-reading a row just trashed), which must reach a row every other
   * path hides.
   */
  async documentIncludingTrashed(
    where: Prisma.DocumentWhereUniqueInput,
  ): Promise<Document | null> {
    return this.prisma.document.findUnique({ where });
  }

  async getDocumentOrThrow(
    where: Prisma.DocumentWhereUniqueInput,
  ): Promise<Document> {
    const doc = await this.document(where);
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  async documents(params: {
    skip?: number;
    take?: number;
    cursor?: Prisma.DocumentWhereUniqueInput;
    where?: Prisma.DocumentWhereInput;
    orderBy?:
      | Prisma.DocumentOrderByWithRelationInput
      | Prisma.DocumentOrderByWithRelationInput[];
  }): Promise<Document[]> {
    const { skip, take, cursor, where, orderBy } = params;
    return this.prisma.document.findMany({
      skip,
      take,
      cursor,
      where: { ...where, ...LIVE_DOCUMENT },
      orderBy,
    });
  }

  /**
   * Like {@link documents} but eager-loads the author for the documents-list
   * "Owner" column. Kept separate so callers that don't need the join
   * (e.g. the REST v1 listing) stay lean.
   */
  async listDocumentsWithAuthor(params: {
    skip?: number;
    take?: number;
    cursor?: Prisma.DocumentWhereUniqueInput;
    where?: Prisma.DocumentWhereInput;
    orderBy?:
      | Prisma.DocumentOrderByWithRelationInput
      | Prisma.DocumentOrderByWithRelationInput[];
  }): Promise<DocumentWithAuthor[]> {
    const { skip, take, cursor, where, orderBy } = params;
    return this.prisma.document.findMany({
      skip,
      take,
      cursor,
      where: { ...where, ...LIVE_DOCUMENT },
      orderBy,
      include: documentListInclude,
    });
  }

  /**
   * The trashed documents of one workspace, most recently trashed first —
   * the one list that shows what every other list hides.
   */
  async listTrash(workspaceId: string): Promise<DocumentWithAuthor[]> {
    return this.prisma.document.findMany({
      where: { workspaceId, ...TRASHED_DOCUMENT },
      orderBy: [{ deletedAt: 'desc' }, { id: 'asc' }],
      include: documentListInclude,
    });
  }

  /**
   * Create a document row, emitting `document.created` in the same
   * transaction unless `event` is `null` (see {@link DocumentCreatedEvent}).
   * The parameter is required so a new creation path has to decide.
   */
  async createDocument(
    data: Prisma.DocumentCreateInput,
    event: DocumentCreatedEvent,
  ): Promise<Document> {
    return writeWithEvents(this.prisma, this.webhookEvents, async (tx) => {
      const doc = await tx.document.create({ data });
      if (event) await this.emitCreated(tx, doc, event);
      return doc;
    });
  }

  /**
   * `document.created` for a document a caller finished building outside
   * {@link createDocument} — a copy, once its content has landed.
   */
  async emitDocumentCreated(
    doc: Document,
    event: NonNullable<DocumentCreatedEvent>,
  ): Promise<void> {
    if (!this.webhookEvents?.enabled) return;
    await this.prisma.$transaction((tx) => this.emitCreated(tx, doc, event));
  }

  private async emitCreated(
    tx: Prisma.TransactionClient,
    doc: Document,
    event: NonNullable<DocumentCreatedEvent>,
  ): Promise<void> {
    await this.webhookEvents?.emitDocumentEvent(tx, {
      type: 'document.created',
      actor: event.actorId,
      document: doc,
      extra: { source: event.source },
    });
  }

  /**
   * Rename and/or move one document. Emits `document.renamed` when the title
   * changed and `document.moved` when its folder or workspace did — read
   * against the row as it was, so a PATCH that repeats the current value
   * reports nothing.
   */
  async updateDocument(
    params: {
      where: Prisma.DocumentWhereUniqueInput;
      data: Prisma.DocumentUpdateInput;
    },
    actorId: DocumentActor,
  ): Promise<Document> {
    const { data, where } = params;
    // A real metadata update (rename, move) is a modification, so advance
    // `updatedAt` — content edits arrive via the Yorkie webhook, but title/
    // workspace changes never touch Yorkie and would otherwise leave the doc
    // stuck at its old "Last modified" time and list position. Skip the bump
    // when there is nothing to update, so an empty / no-op PATCH does not
    // spuriously re-sort the document to the top of the list.
    const nextData =
      Object.keys(data).length > 0 ? { ...data, updatedAt: new Date() } : data;
    return writeWithEvents(this.prisma, this.webhookEvents, async (tx) => {
      const before = this.webhookEvents?.enabled
        ? await tx.document.findUnique({ where })
        : null;
      const after = await tx.document.update({ data: nextData, where });
      if (before) await this.emitChange(tx, before, after, actorId);
      return after;
    });
  }

  /**
   * The rename / move events one update produced. A cross-workspace move is
   * reported to both workspaces, each half filtered on its own folder.
   */
  private async emitChange(
    tx: Prisma.TransactionClient,
    before: Document,
    after: Document,
    actorId: DocumentActor,
  ): Promise<void> {
    const events = this.webhookEvents;
    if (!events) return;
    if (before.title !== after.title) {
      await events.emitDocumentEvent(tx, {
        type: 'document.renamed',
        actor: actorId,
        document: after,
      });
    }
    const crossWorkspace = before.workspaceId !== after.workspaceId;
    if (!crossWorkspace && before.folderId === after.folderId) return;

    const fromFolder = await events.folderRef(tx, before.folderId);
    const toFolder = await events.folderRef(tx, after.folderId);
    const extra: Record<string, unknown> = {
      from_folder: fromFolder,
      to_folder: toFolder,
    };
    if (!crossWorkspace) {
      await events.emitDocumentEvent(tx, {
        type: 'document.moved',
        actor: actorId,
        document: after,
        folder: toFolder,
        filterFolderId: [before.folderId, after.folderId],
        extra,
      });
      return;
    }
    extra.from_workspace_id = before.workspaceId;
    extra.to_workspace_id = after.workspaceId;
    for (const [workspaceId, folderId] of [
      [before.workspaceId, before.folderId],
      [after.workspaceId, after.folderId],
    ] as const) {
      await events.emitDocumentEvent(tx, {
        type: 'document.moved',
        actor: actorId,
        document: after,
        folder: toFolder,
        workspaceId,
        filterFolderId: folderId,
        extra,
      });
    }
  }

  /**
   * Apply a set of document updates in a single transaction, bumping each
   * document's `updatedAt` (matching {@link updateDocument}). Used by the bulk
   * move endpoint so N relocations are atomic. Validation of who may move what
   * happens in the controller before this runs.
   */
  async moveDocuments(
    updates: Array<{ id: string; data: Prisma.DocumentUpdateInput }>,
    actorId: DocumentActor,
  ): Promise<number> {
    if (updates.length === 0) return 0;
    const at = new Date();
    if (!this.webhookEvents?.enabled) {
      await this.prisma.$transaction(
        updates.map((u) =>
          this.prisma.document.update({
            where: { id: u.id },
            data: { ...u.data, updatedAt: at },
          }),
        ),
      );
      return updates.length;
    }
    // One `document.moved` per document, inside the move's transaction.
    await this.prisma.$transaction(async (tx) => {
      for (const u of updates) {
        const before = await tx.document.findUnique({ where: { id: u.id } });
        const after = await tx.document.update({
          where: { id: u.id },
          data: { ...u.data, updatedAt: at },
        });
        if (before) await this.emitChange(tx, before, after, actorId);
      }
    });
    return updates.length;
  }

  /**
   * Move live documents to the trash. Already-trashed ids are left alone so
   * a repeated request does not reset when they were trashed. Blobs are kept:
   * a trashed document can be restored, so its bytes must survive.
   * `updatedAt` is not touched — trashing is not an edit, and a restored
   * document should sort where it did before.
   */
  async trashDocuments(ids: string[], actorId: DocumentActor): Promise<number> {
    if (ids.length === 0) return 0;
    const deletedAt = new Date();
    if (!this.webhookEvents?.enabled) {
      const { count } = await this.prisma.document.updateMany({
        where: { id: { in: ids }, ...LIVE_DOCUMENT },
        data: { deletedAt },
      });
      return count;
    }
    // Each id is its own compare-and-set so `document.trashed` is emitted
    // exactly for the rows this call trashed — never for one a concurrent
    // request got to first. One event per document, bulk or not.
    return this.prisma.$transaction(async (tx) => {
      const live = await tx.document.findMany({
        where: { id: { in: ids }, ...LIVE_DOCUMENT },
      });
      let trashed = 0;
      for (const doc of live) {
        const { count } = await tx.document.updateMany({
          where: { id: doc.id, ...LIVE_DOCUMENT },
          data: { deletedAt },
        });
        if (count === 0) continue;
        trashed++;
        await this.webhookEvents?.emitDocumentEvent(tx, {
          type: 'document.trashed',
          actor: actorId,
          document: doc,
        });
      }
      return trashed;
    });
  }

  /**
   * Bring a trashed document back. Returns `null` when the id is missing or
   * not in the trash. Its folder needs no handling here: deleting a folder
   * already `SetNull`s `folderId` on every document in it (trashed ones
   * included), so a document whose folder is gone returns to the root.
   */
  async restoreDocument(
    id: string,
    actorId: DocumentActor,
  ): Promise<Document | null> {
    return writeWithEvents(this.prisma, this.webhookEvents, async (tx) => {
      const { count } = await tx.document.updateMany({
        where: { id, ...TRASHED_DOCUMENT },
        data: { deletedAt: null },
      });
      if (count === 0) return null;
      const doc = await tx.document.findUnique({
        where: { id, ...LIVE_DOCUMENT },
      });
      if (doc) {
        await this.webhookEvents?.emitDocumentEvent(tx, {
          type: 'document.restored',
          actor: actorId,
          document: doc,
        });
      }
      return doc;
    });
  }

  /**
   * Unconditionally delete a document row. Not a trash route: it is the
   * rollback for a copy whose content write failed, which must remove the
   * half-made row it just created. User-facing permanent deletes go through
   * {@link purgeTrashedDocument}, which can only reach the trash.
   */
  async deleteDocument(
    where: Prisma.DocumentWhereUniqueInput,
  ): Promise<Document> {
    return this.prisma.document.delete({
      where,
    });
  }

  /**
   * A trashed document, or `null` when it is missing or live. The read half
   * of a permanent delete: only something already in the trash may be
   * destroyed (docs/design/document-trash.md).
   */
  async trashedDocument(
    where: Prisma.DocumentWhereUniqueInput,
  ): Promise<Document | null> {
    return this.prisma.document.findUnique({
      where: { ...where, ...TRASHED_DOCUMENT },
    });
  }

  /**
   * Permanently delete one document, **only if it is still in the trash**.
   * The `deletedAt IS NOT NULL` condition is part of the write itself, so it
   * is a compare-and-set: a collaborator who restored the document after the
   * caller read the trash list wins, and the now-live document survives.
   * Returns whether a row was deleted — the caller must only clean up the
   * blob when it was.
   */
  async purgeTrashedDocument(
    id: string,
    actorId: DocumentActor,
  ): Promise<boolean> {
    return writeWithEvents(this.prisma, this.webhookEvents, async (tx) => {
      // `document.deleted` describes a row that is about to stop existing, so
      // it is read first; the event is emitted only if the delete won.
      const doc = this.webhookEvents?.enabled
        ? await tx.document.findUnique({ where: { id, ...TRASHED_DOCUMENT } })
        : null;
      const { count } = await tx.document.deleteMany({
        where: { id, ...TRASHED_DOCUMENT },
      });
      if (count > 0 && doc) {
        await this.webhookEvents?.emitDocumentEvent(tx, {
          type: 'document.deleted',
          actor: actorId,
          document: doc,
        });
      }
      return count > 0;
    });
  }

  /**
   * {@link purgeTrashedDocument} for many ids. Each id is its own
   * compare-and-set, so the result names exactly the ids that were destroyed
   * — an id restored mid-request is left live and left out of the result, and
   * its blob is never touched. Blob cleanup for file-backed types (pdf /
   * image / file) is done best-effort by the controller after this returns.
   * Each destroyed id emits its own `document.deleted`.
   */
  async purgeTrashedDocuments(
    ids: string[],
    actorId: DocumentActor,
  ): Promise<string[]> {
    const purged: string[] = [];
    for (const id of ids) {
      if (await this.purgeTrashedDocument(id, actorId)) purged.push(id);
    }
    return purged;
  }

  /**
   * Advance a document's `updatedAt` to `at`, but only if it moves the time
   * forward. Used by the Yorkie `DocumentRootChanged` event webhook, whose
   * delivery is at-least-once, unordered, and retried — so this must be
   * idempotent and monotonic. A missing document (deleted, or a key we don't
   * track) is a silent no-op. Returns the number of rows updated (0 or 1).
   */
  async touchUpdatedAt(id: string, at: Date): Promise<number> {
    const { count } = await this.prisma.document.updateMany({
      where: { id, updatedAt: { lt: at } },
      data: { updatedAt: at },
    });
    return count;
  }
}
