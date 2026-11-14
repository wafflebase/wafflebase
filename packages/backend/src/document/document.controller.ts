import {
  Req,
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DocumentService, DocumentWithAuthor } from './document.service';
import { DocumentCopyService } from './document-copy.service';
import { Document as DocumentModel, Prisma } from '@prisma/client';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { AuthenticatedRequest } from 'src/auth/auth.types';
import { WorkspaceService } from '../workspace/workspace.service';
import {
  CreateDocumentDto,
  CreateDocumentInWorkspaceDto,
  DeleteDocumentsDto,
  MoveDocumentsDto,
  UpdateDocumentDto,
} from './document.dto';
import {
  PresenceUser,
  YorkieAdminService,
} from '../yorkie/yorkie-admin.service';
import { yorkieDocKey } from '../yorkie/yorkie-doc-key';
import { FileService } from '../file/file.service';
import { VALID_FILE_ID_PATTERN } from '../file/file.constants';
import { isDocumentManager } from './document-access';
import { assertFileIdAllowed } from './document-file-id.util';
import { FolderService } from '../folder/folder.service';

// `folderId` is part of the row via the `...d` spread below (the `Document`
// model now carries it — see `document.dto.ts` / Task 1's Prisma migration).
type DocumentListItem = Omit<DocumentWithAuthor, 'updatedAt' | 'deletedAt'> & {
  editors?: PresenceUser[];
  // Last-modified time (ISO). Sourced from the Postgres `Document.updatedAt`
  // column, which the Yorkie `DocumentRootChanged` event webhook advances on
  // each edit (see yorkie-event.controller.ts). Stable across requests, unlike
  // the per-request Yorkie admin call — so the list order no longer flips when
  // that call times out.
  updatedAt: string;
  // Whether the caller may delete or move this document — workspace owner or
  // the document's author (see `resolveDocManager`). Lets the client gate the
  // Delete/Move menu items without re-deriving roles per workspace.
  canManage: boolean;
  // When the document was moved to the trash (ISO), or null while it is live.
  // Only the trash list ever carries a non-null value.
  deletedAt: string | null;
};

/**
 * `?permanent=true` on `DELETE /documents/:id`. Only the literal `true`
 * opts into a hard delete, so a typo falls back to the recoverable trash
 * rather than destroying the document.
 */
function isPermanent(value: string | undefined): boolean {
  return value === 'true';
}

@Controller()
@UseGuards(JwtAuthGuard)
export class DocumentController {
  constructor(
    private readonly documentService: DocumentService,
    private readonly documentCopyService: DocumentCopyService,
    private readonly workspaceService: WorkspaceService,
    private readonly yorkieAdminService: YorkieAdminService,
    private readonly fileService: FileService,
    private readonly folderService: FolderService,
  ) {}

  private async attachMeta(
    docs: DocumentWithAuthor[],
    roleByWorkspace: Map<string, string>,
    userId: number,
  ): Promise<DocumentListItem[]> {
    if (docs.length === 0) return [];
    // The Yorkie admin call now supplies only the decorative "currently
    // editing" avatars — it is best-effort and its failure/timeout no longer
    // affects ordering, which reads the stable Postgres `updatedAt`.
    const keys = docs.map((d) => yorkieDocKey(d.type, d.id));
    const editorsByKey = await this.yorkieAdminService.getEditors(keys);
    return docs.map((d, i) => {
      const item: DocumentListItem = {
        ...d,
        updatedAt: d.updatedAt.toISOString(),
        deletedAt: d.deletedAt ? d.deletedAt.toISOString() : null,
        canManage: isDocumentManager(
          roleByWorkspace.get(d.workspaceId),
          d.authorID,
          userId,
        ),
      };
      const editors = editorsByKey.get(keys[i]);
      if (editors?.length) item.editors = editors;
      return item;
    });
  }

  /**
   * A document's "manager" — the workspace owner or the document's author — is
   * the tier allowed to delete or move it (parity with the share-link
   * `isManager` gate; see docs/design/sharing.md). Plain members have `rw` on
   * the content but may not destroy or relocate a document they do not own.
   * Requires workspace membership first, so a removed author cannot act.
   */
  private async resolveDocManager(
    doc: { workspaceId: string; authorID: number | null },
    userId: number,
  ): Promise<boolean> {
    const member = await this.workspaceService.assertMember(
      doc.workspaceId,
      userId,
    );
    return isDocumentManager(member.role, doc.authorID, userId);
  }

  // --- Workspace-scoped endpoints ---

  @Post('workspaces/:workspaceId/documents')
  async createInWorkspace(
    @Param('workspaceId') workspaceIdOrSlug: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateDocumentDto,
  ): Promise<DocumentModel> {
    const userId = Number(req.user.id);
    const workspaceId =
      await this.workspaceService.resolveId(workspaceIdOrSlug);
    await this.workspaceService.assertMember(workspaceId, userId);
    assertFileIdAllowed(body.type, body.fileId);
    // Blob metadata rides with the blob: without a fileId there is nothing for
    // it to describe, so it is dropped rather than trusted.
    const blobMeta = body.fileId
      ? { fileSize: body.fileSize, mimeType: body.mimeType }
      : {};
    if (body.folderId) {
      await this.folderService.assertSameWorkspace(body.folderId, workspaceId);
    }
    return this.documentService.createDocument({
      title: body.title,
      type: body.type ?? 'sheet',
      fileId: body.fileId,
      ...blobMeta,
      author: { connect: { id: userId } },
      workspace: { connect: { id: workspaceId } },
      ...(body.folderId ? { folder: { connect: { id: body.folderId } } } : {}),
    });
  }

  @Get('workspaces/:workspaceId/documents')
  async findByWorkspace(
    @Param('workspaceId') workspaceIdOrSlug: string,
    @Req() req: AuthenticatedRequest,
    @Query('folderId') folderId?: string,
  ): Promise<DocumentListItem[]> {
    const userId = Number(req.user.id);
    const workspaceId =
      await this.workspaceService.resolveId(workspaceIdOrSlug);
    const member = await this.workspaceService.assertMember(workspaceId, userId);
    const docs = await this.documentService.listDocumentsWithAuthor({
      where: { workspaceId, folderId: folderId ?? null },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return this.attachMeta(docs, new Map([[workspaceId, member.role]]), userId);
  }

  /**
   * The workspace's trash: every trashed document, most recently trashed
   * first, in the same row shape as the workspace list. Member-gated like
   * that list — a member could see these documents before they were trashed.
   * `canManage` says which rows the caller may restore or delete for good.
   */
  @Get('workspaces/:workspaceId/trash')
  async findTrashByWorkspace(
    @Param('workspaceId') workspaceIdOrSlug: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<DocumentListItem[]> {
    const userId = Number(req.user.id);
    const workspaceId =
      await this.workspaceService.resolveId(workspaceIdOrSlug);
    const member = await this.workspaceService.assertMember(
      workspaceId,
      userId,
    );
    const docs = await this.documentService.listTrash(workspaceId);
    return this.attachMeta(docs, new Map([[workspaceId, member.role]]), userId);
  }

  // --- Legacy / backward-compatible endpoints ---

  @Get('documents/:id')
  async getDocumentById(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<DocumentModel | null> {
    const doc = await this.documentService.document({ id });
    if (!doc) {
      throw new NotFoundException('Document not found');
    }
    await this.workspaceService.assertMember(
      doc.workspaceId,
      Number(req.user.id),
    );
    return doc;
  }

  @Get('documents')
  async getDocuments(
    @Req() req: AuthenticatedRequest,
  ): Promise<DocumentListItem[]> {
    const userId = Number(req.user.id);
    const memberships = await this.workspaceService.findMembershipsByUser(userId);
    const roleByWorkspace = new Map(
      memberships.map((m) => [m.workspaceId, m.role]),
    );
    const workspaceIds = memberships.map((m) => m.workspaceId);
    const docs = await this.documentService.listDocumentsWithAuthor({
      where: { workspaceId: { in: workspaceIds } },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return this.attachMeta(docs, roleByWorkspace, userId);
  }

  @Post('documents')
  async createDocument(
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateDocumentInWorkspaceDto,
  ): Promise<DocumentModel> {
    const userId = Number(req.user.id);
    await this.workspaceService.assertMember(body.workspaceId, userId);
    assertFileIdAllowed(body.type, body.fileId);
    // Blob metadata rides with the blob: without a fileId there is nothing for
    // it to describe, so it is dropped rather than trusted.
    const blobMeta = body.fileId
      ? { fileSize: body.fileSize, mimeType: body.mimeType }
      : {};
    if (body.folderId) {
      await this.folderService.assertSameWorkspace(
        body.folderId,
        body.workspaceId,
      );
    }
    return this.documentService.createDocument({
      title: body.title,
      type: body.type ?? 'sheet',
      fileId: body.fileId,
      ...blobMeta,
      author: { connect: { id: userId } },
      workspace: { connect: { id: body.workspaceId } },
      ...(body.folderId ? { folder: { connect: { id: body.folderId } } } : {}),
    });
  }

  // Bulk move must be declared before `documents/:id` so the literal `move`
  // segment isn't captured as an `:id`. Atomic: any missing / non-manageable
  // id rejects the whole request before any write.
  @Patch('documents/move')
  async moveDocuments(
    @Req() req: AuthenticatedRequest,
    @Body() body: MoveDocumentsDto,
  ): Promise<{ moved: string[] }> {
    const userId = Number(req.user.id);
    if (body.ids.length === 0) {
      throw new BadRequestException('No documents specified');
    }
    const docs = await Promise.all(
      body.ids.map((id) => this.documentService.document({ id })),
    );
    const denied: string[] = [];
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      if (!doc || !(await this.resolveDocManager(doc, userId))) {
        denied.push(body.ids[i]);
      }
    }
    if (denied.length > 0) {
      throw new ForbiddenException(
        `Cannot move documents you do not manage: ${denied.join(', ')}`,
      );
    }
    if (body.workspaceId !== undefined) {
      await this.workspaceService.assertMember(body.workspaceId, userId);
    }
    const updates: Array<{ id: string; data: Prisma.DocumentUpdateInput }> = [];
    for (const doc of docs) {
      const data: Prisma.DocumentUpdateInput = {};
      if (body.workspaceId !== undefined) {
        data.workspace = { connect: { id: body.workspaceId } };
        if (
          body.workspaceId !== doc!.workspaceId &&
          body.folderId === undefined
        ) {
          data.folder = { disconnect: true };
        }
      }
      if (body.folderId !== undefined) {
        if (body.folderId === null) {
          data.folder = { disconnect: true };
        } else {
          const targetWorkspaceId = body.workspaceId ?? doc!.workspaceId;
          await this.folderService.assertSameWorkspace(
            body.folderId,
            targetWorkspaceId,
          );
          data.folder = { connect: { id: body.folderId } };
        }
      }
      updates.push({ id: doc!.id, data });
    }
    await this.documentService.moveDocuments(updates);
    return { moved: updates.map((u) => u.id) };
  }

  /**
   * Duplicate a document into the same workspace and folder as
   * `<title> (copy)` — see docs/design/document-copy.md.
   *
   * Gated on workspace membership only, deliberately **not** on
   * `resolveDocManager`: a copy neither modifies, moves, nor destroys the
   * source, so anyone who can read the document can duplicate it. This is the
   * one document action where that gate diverges from move/delete.
   */
  @Post('documents/:id/copy')
  async copyDocument(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<DocumentModel> {
    const doc = await this.documentService.document({ id });
    if (!doc) {
      throw new NotFoundException('Document not found');
    }
    const userId = Number(req.user.id);
    await this.workspaceService.assertMember(doc.workspaceId, userId);
    return this.documentCopyService.copy(doc, userId);
  }

  @Patch('documents/:id')
  async updateDocument(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: UpdateDocumentDto,
  ): Promise<DocumentModel> {
    const doc = await this.documentService.document({ id });
    if (!doc) {
      throw new NotFoundException('Document not found');
    }
    const userId = Number(req.user.id);
    // Renaming is an edit any member may do; moving is a manager-only action.
    const isManager = await this.resolveDocManager(doc, userId);

    const data: {
      title?: string;
      workspace?: { connect: { id: string } };
      folder?: { connect: { id: string } } | { disconnect: true };
    } = {};
    if (body.title !== undefined) {
      data.title = body.title;
    }
    if (body.workspaceId !== undefined) {
      if (!isManager) {
        throw new ForbiddenException(
          'Only the workspace owner or document owner can move this document',
        );
      }
      await this.workspaceService.assertMember(body.workspaceId, userId);
      data.workspace = { connect: { id: body.workspaceId } };
      // Moving to a different workspace: the current folder (if any) belongs to
      // the old workspace, so drop it — otherwise the document keeps a folderId
      // pointing across the workspace boundary. A caller that wants it filed in
      // the target workspace supplies `folderId` explicitly (handled below).
      if (body.workspaceId !== doc.workspaceId && body.folderId === undefined) {
        data.folder = { disconnect: true };
      }
    }
    if (body.folderId !== undefined) {
      if (!isManager) {
        throw new ForbiddenException(
          'Only the workspace owner or document owner can move this document',
        );
      }
      if (body.folderId === null) {
        data.folder = { disconnect: true };
      } else {
        const targetWorkspaceId = body.workspaceId ?? doc.workspaceId;
        await this.folderService.assertSameWorkspace(
          body.folderId,
          targetWorkspaceId,
        );
        data.folder = { connect: { id: body.folderId } };
      }
    }

    return this.documentService.updateDocument({
      where: { id },
      data,
    });
  }

  /**
   * Move a document to the trash, or with `?permanent=true` delete it for
   * good. Both are manager-gated. Each reaches only one side of the trash: a
   * soft delete only live documents (trashing an already-trashed one is a
   * 404), a permanent delete only trashed ones (a live id is a 404). The
   * latter is what keeps a stale Trash page from destroying a document a
   * collaborator restored after it loaded — and the condition is re-checked
   * in the delete itself, so a restore that lands between the read and the
   * write still wins.
   */
  @Delete('documents/:id')
  async deleteDocument(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('permanent') permanent?: string,
  ): Promise<DocumentModel> {
    const hard = isPermanent(permanent);
    const doc = hard
      ? await this.documentService.trashedDocument({ id })
      : await this.documentService.document({ id });
    if (!doc) {
      throw new NotFoundException('Document not found');
    }
    if (!(await this.resolveDocManager(doc, Number(req.user.id)))) {
      throw new ForbiddenException(
        'Only the workspace owner or document owner can delete this document',
      );
    }
    if (!hard) {
      await this.documentService.trashDocuments([id]);
      const trashed = await this.documentService.documentIncludingTrashed({
        id,
      });
      if (!trashed) throw new NotFoundException('Document not found');
      return trashed;
    }
    if (!(await this.documentService.purgeTrashedDocument(id))) {
      // Restored or purged by somebody else between the read and the write.
      throw new NotFoundException('Document not found in trash');
    }
    await this.deleteBlobs([doc]);
    return doc;
  }

  /**
   * Restore a trashed document. Manager-gated, the same tier that trashed it.
   * A live or missing id is a 404. A document whose folder was deleted while
   * it sat in the trash comes back at the workspace root (`folderId` was
   * already `SetNull`ed by the folder delete).
   */
  @Post('documents/:id/restore')
  async restoreDocument(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<DocumentModel> {
    const doc = await this.documentService.documentIncludingTrashed({ id });
    if (!doc || doc.deletedAt === null) {
      throw new NotFoundException('Document not found in trash');
    }
    if (!(await this.resolveDocManager(doc, Number(req.user.id)))) {
      throw new ForbiddenException(
        'Only the workspace owner or document owner can restore this document',
      );
    }
    const restored = await this.documentService.restoreDocument(id);
    if (!restored) {
      // Restored or purged by somebody else between the read and the write.
      throw new NotFoundException('Document not found in trash');
    }
    return restored;
  }

  /**
   * Bulk counterpart of `DELETE /documents/:id`: trash by default, delete for
   * good with `{ permanent: true }`. Atomic in its gate — any missing or
   * non-manageable id rejects the whole request before any write. For a
   * permanent delete a live id counts as missing: only the trash can be
   * emptied. Each destruction is then its own compare-and-set, so an id
   * restored after the gate survives, and `deleted` names only the ids that
   * were actually destroyed.
   */
  @Post('documents/delete')
  async deleteDocuments(
    @Req() req: AuthenticatedRequest,
    @Body() body: DeleteDocumentsDto,
  ): Promise<{ deleted: string[] }> {
    const userId = Number(req.user.id);
    if (body.ids.length === 0) {
      throw new BadRequestException('No documents specified');
    }
    const hard = body.permanent === true;
    const docs = await Promise.all(
      body.ids.map((id) =>
        hard
          ? this.documentService.trashedDocument({ id })
          : this.documentService.document({ id }),
      ),
    );
    const denied: string[] = [];
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      if (!doc || !(await this.resolveDocManager(doc, userId))) {
        denied.push(body.ids[i]);
      }
    }
    if (denied.length > 0) {
      throw new ForbiddenException(
        `Cannot delete documents you do not manage: ${denied.join(', ')}`,
      );
    }
    if (!hard) {
      await this.documentService.trashDocuments(body.ids);
      return { deleted: body.ids };
    }
    const purged = await this.documentService.purgeTrashedDocuments(body.ids);
    const purgedIds = new Set(purged);
    await this.deleteBlobs(docs.filter((doc) => doc && purgedIds.has(doc.id)));
    return { deleted: purged };
  }

  /**
   * Best-effort blob cleanup after a permanent delete. A trashed document
   * keeps its blob (it can be restored), so this runs only once the row is
   * gone. A failed cleanup must not fail the delete, but is logged so an
   * orphaned object has operational visibility.
   */
  private async deleteBlobs(
    docs: Array<Pick<DocumentModel, 'fileId'> | null>,
  ): Promise<void> {
    for (const doc of docs) {
      if (doc?.fileId && VALID_FILE_ID_PATTERN.test(doc.fileId)) {
        await this.fileService.delete(doc.fileId).catch((err) => {
          console.warn(
            `[DocumentController] Failed to delete blob ${doc.fileId}:`,
            err instanceof Error ? err.message : err,
          );
        });
      }
    }
  }
}
