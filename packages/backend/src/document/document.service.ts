import { Injectable, NotFoundException } from '@nestjs/common';
import { Document, Prisma } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { LIVE_DOCUMENT, TRASHED_DOCUMENT } from './live-document';

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
  constructor(private prisma: PrismaService) {}

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

  async createDocument(data: Prisma.DocumentCreateInput): Promise<Document> {
    const doc = await this.prisma.document.create({
      data,
    });
    return doc;
  }

  async updateDocument(params: {
    where: Prisma.DocumentWhereUniqueInput;
    data: Prisma.DocumentUpdateInput;
  }): Promise<Document> {
    const { data, where } = params;
    // A real metadata update (rename, move) is a modification, so advance
    // `updatedAt` — content edits arrive via the Yorkie webhook, but title/
    // workspace changes never touch Yorkie and would otherwise leave the doc
    // stuck at its old "Last modified" time and list position. Skip the bump
    // when there is nothing to update, so an empty / no-op PATCH does not
    // spuriously re-sort the document to the top of the list.
    const nextData =
      Object.keys(data).length > 0 ? { ...data, updatedAt: new Date() } : data;
    return this.prisma.document.update({ data: nextData, where });
  }

  /**
   * Apply a set of document updates in a single transaction, bumping each
   * document's `updatedAt` (matching {@link updateDocument}). Used by the bulk
   * move endpoint so N relocations are atomic. Validation of who may move what
   * happens in the controller before this runs.
   */
  async moveDocuments(
    updates: Array<{ id: string; data: Prisma.DocumentUpdateInput }>,
  ): Promise<number> {
    if (updates.length === 0) return 0;
    const at = new Date();
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

  /**
   * Move live documents to the trash. Already-trashed ids are left alone so
   * a repeated request does not reset when they were trashed. Blobs are kept:
   * a trashed document can be restored, so its bytes must survive.
   * `updatedAt` is not touched — trashing is not an edit, and a restored
   * document should sort where it did before.
   */
  async trashDocuments(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const { count } = await this.prisma.document.updateMany({
      where: { id: { in: ids }, ...LIVE_DOCUMENT },
      data: { deletedAt: new Date() },
    });
    return count;
  }

  /**
   * Bring a trashed document back. Returns `null` when the id is missing or
   * not in the trash. Its folder needs no handling here: deleting a folder
   * already `SetNull`s `folderId` on every document in it (trashed ones
   * included), so a document whose folder is gone returns to the root.
   */
  async restoreDocument(id: string): Promise<Document | null> {
    const { count } = await this.prisma.document.updateMany({
      where: { id, ...TRASHED_DOCUMENT },
      data: { deletedAt: null },
    });
    if (count === 0) return null;
    return this.document({ id });
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
  async purgeTrashedDocument(id: string): Promise<boolean> {
    const { count } = await this.prisma.document.deleteMany({
      where: { id, ...TRASHED_DOCUMENT },
    });
    return count > 0;
  }

  /**
   * {@link purgeTrashedDocument} for many ids. Each id is its own
   * compare-and-set, so the result names exactly the ids that were destroyed
   * — an id restored mid-request is left live and left out of the result, and
   * its blob is never touched. Blob cleanup for file-backed types (pdf /
   * image / file) is done best-effort by the controller after this returns.
   */
  async purgeTrashedDocuments(ids: string[]): Promise<string[]> {
    const purged: string[] = [];
    for (const id of ids) {
      if (await this.purgeTrashedDocument(id)) purged.push(id);
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
