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
    return this.prisma.document.update({
      data,
      where,
    });
  }

  async deleteDocument(
    where: Prisma.DocumentWhereUniqueInput,
  ): Promise<Document> {
    return this.prisma.document.delete({
      where,
    });
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
