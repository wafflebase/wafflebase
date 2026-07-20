import { Injectable, NotFoundException } from '@nestjs/common';
import { Document, Prisma } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';

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

@Injectable()
export class DocumentService {
  constructor(private prisma: PrismaService) {}

  async document(
    postWhereUniqueInput: Prisma.DocumentWhereUniqueInput,
  ): Promise<Document | null> {
    return this.prisma.document.findUnique({
      where: postWhereUniqueInput,
    });
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
      where,
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
      where,
      orderBy,
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

  async deleteDocument(
    where: Prisma.DocumentWhereUniqueInput,
  ): Promise<Document> {
    return this.prisma.document.delete({
      where,
    });
  }

  /**
   * Delete many documents by id. Blob cleanup for file-backed types (pdf /
   * image) is done best-effort by the controller after this returns.
   */
  async deleteDocuments(ids: string[]): Promise<number> {
    const { count } = await this.prisma.document.deleteMany({
      where: { id: { in: ids } },
    });
    return count;
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
