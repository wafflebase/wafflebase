import {
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
  Req,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ApiKeyWriteScopeGuard } from './api-key-write-scope.guard';
import { DocumentService } from '../../document/document.service';
import { DocumentCopyService } from '../../document/document-copy.service';
import { FolderService } from '../../folder/folder.service';
import { isDocumentManager } from '../../document/document-access';
import { WorkspaceService } from '../../workspace/workspace.service';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { YorkieAdminService } from '../../yorkie/yorkie-admin.service';
import { yorkieDocKey } from '../../yorkie/yorkie-doc-key';
import { FileService } from '../../file/file.service';
import { VALID_FILE_ID_PATTERN } from '../../file/file.constants';
import {
  ApiV1CreateDocumentDto,
  ApiV1UpdateDocumentDto,
} from './documents.dto';

@Controller('api/v1/workspaces/:workspaceId/documents')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard, ApiKeyWriteScopeGuard)
export class ApiV1DocumentsController {
  constructor(
    private readonly documentService: DocumentService,
    private readonly yorkieAdminService: YorkieAdminService,
    private readonly workspaceService: WorkspaceService,
    private readonly fileService: FileService,
    private readonly documentCopyService: DocumentCopyService,
    private readonly folderService: FolderService,
  ) {}

  @Get()
  async list(@Param('workspaceId') workspaceId: string) {
    const docs = await this.documentService.documents({
      where: { workspaceId },
    });
    if (docs.length === 0) return docs;
    const keys = docs.map((d) => yorkieDocKey(d.type, d.id));
    const editorsByKey = await this.yorkieAdminService.getEditors(keys);
    return docs.map((d, i) => {
      const editors = editorsByKey.get(keys[i]);
      return editors ? { ...d, editors } : d;
    });
  }

  @Post()
  async create(
    @Param('workspaceId') workspaceId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: ApiV1CreateDocumentDto,
  ) {
    return this.documentService.createDocument({
      title: body.title,
      type:
        body.type === 'doc' ||
        body.type === 'slides' ||
        body.type === 'note' ||
        body.type === 'board'
          ? body.type
          : 'sheet',
      workspace: { connect: { id: workspaceId } },
      author: { connect: { id: Number(req.user.id) } },
    });
  }

  @Get(':documentId')
  async get(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.documentService.getDocumentOrThrow({
      id: documentId,
      workspaceId,
    });
  }

  /**
   * Duplicate a document into the same workspace and folder as
   * `<title> (copy)` — the same engine the web "Make a copy" runs
   * (docs/design/document-copy.md).
   *
   * Declared before `:documentId` routes that could swallow it is not a
   * concern here (`copy` is a second segment, not an id), but the gate is:
   * membership only, deliberately **not** the manager check `remove` applies.
   * A copy neither modifies, moves, nor destroys the source, so anyone who can
   * read the document can duplicate it — and `WorkspaceScopeGuard` has already
   * established the caller belongs to the workspace it lives in.
   */
  @Post(':documentId/copy')
  async copy(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const doc = await this.documentService.getDocumentOrThrow({
      id: documentId,
      workspaceId,
    });
    return this.documentCopyService.copy(doc, Number(req.user.id));
  }

  @Patch(':documentId')
  async update(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: ApiV1UpdateDocumentDto,
  ) {
    const doc = await this.documentService.getDocumentOrThrow({
      id: documentId,
      workspaceId,
    });

    // Build the update explicitly rather than spreading `body`. The DTO on the
    // parameter above is what makes the global pipe strip a hostile key, but
    // this surface writes straight into `prisma.document.update`, so the
    // handler names the columns it is allowed to touch too. Assigned
    // conditionally, never as `{ title: undefined }` — `updateDocument` counts
    // the keys to decide whether to bump `updatedAt`, and a no-op PATCH must
    // not re-sort the document to the top of the list.
    const data: Prisma.DocumentUpdateInput = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.folderId !== undefined) {
      // Renaming is an edit any member may do; filing the document somewhere
      // else is manager-only, the same split the web surface draws. An API key
      // is held to the same bar as its minter (see `remove` below).
      const userId = Number(req.user.id);
      const member = await this.workspaceService.assertMember(
        workspaceId,
        userId,
      );
      if (!isDocumentManager(member.role, doc.authorID, userId)) {
        throw new ForbiddenException(
          'Only the workspace owner or document owner can move this document',
        );
      }
      if (body.folderId === null) {
        data.folder = { disconnect: true };
      } else {
        // There is no cross-workspace move on this surface — an API key is
        // bound to one workspace — so the target folder is checked against the
        // document's own workspace.
        await this.folderService.assertSameWorkspace(
          body.folderId,
          workspaceId,
        );
        data.folder = { connect: { id: body.folderId } };
      }
    }

    return this.documentService.updateDocument({
      where: { id: documentId },
      data,
    });
  }

  /**
   * Move a document to the trash — or, with `?permanent=true`, delete it for
   * good together with its blob. The same contract as the web
   * `DELETE /documents/:id` (docs/design/document-trash.md): a permanent
   * delete reaches only a document already in the trash, and re-checks that
   * in the delete itself, so a live (or just-restored) document is a 404
   * rather than destroyed.
   */
  @Delete(':documentId')
  async remove(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Req() req: AuthenticatedRequest,
    @Query('permanent') permanent?: string,
  ) {
    // Only the literal `true` destroys; anything else lands in the trash.
    const hard = permanent === 'true';
    const doc = hard
      ? await this.documentService.trashedDocument({
          id: documentId,
          workspaceId,
        })
      : await this.documentService.document({ id: documentId, workspaceId });
    if (!doc) throw new NotFoundException('Document not found');
    await this.assertManager(workspaceId, doc, req, 'delete');
    if (!hard) {
      await this.documentService.trashDocuments([documentId]);
      const trashed = await this.documentService.documentIncludingTrashed({
        id: documentId,
      });
      if (!trashed) throw new NotFoundException('Document not found');
      return trashed;
    }
    if (!(await this.documentService.purgeTrashedDocument(documentId))) {
      // Restored or purged by somebody else between the read and the write.
      throw new NotFoundException('Document not found in trash');
    }
    if (doc.fileId && VALID_FILE_ID_PATTERN.test(doc.fileId)) {
      // Same cleanup the JWT delete does. It became routine here once `POST
      // /files` let this surface create blob documents in the first place;
      // without it every CLI delete leaks its bytes. Best-effort — a failed
      // cleanup must not fail the delete, but log it so an orphaned object has
      // operational visibility. Only on a permanent delete: a trashed
      // document can be restored, so its bytes must survive.
      await this.fileService.delete(doc.fileId).catch((err) => {
        console.warn(
          `[ApiV1DocumentsController] Failed to delete blob ${doc.fileId}:`,
          err instanceof Error ? err.message : err,
        );
      });
    }
    return doc;
  }

  /** Restore a trashed document. 404 when it is missing or not trashed. */
  @Post(':documentId/restore')
  async restore(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const doc = await this.documentService.documentIncludingTrashed({
      id: documentId,
      workspaceId,
    });
    if (!doc || doc.deletedAt === null) {
      throw new NotFoundException('Document not found in trash');
    }
    await this.assertManager(workspaceId, doc, req, 'restore');
    const restored = await this.documentService.restoreDocument(documentId);
    if (!restored) throw new NotFoundException('Document not found in trash');
    return restored;
  }

  /**
   * Only a manager — the workspace owner or the document's author — may
   * trash, restore or delete. An API key carries the authority of the user
   * who minted it, resolved against their membership *now* rather than at
   * mint time. Any member may mint one, so the role is read here and not
   * assumed: a live owner's key deletes as before, a plain member's key
   * deletes only their own documents, and a key whose minter was removed
   * deletes nothing. `ApiKeyWriteScopeGuard` has already rejected a key
   * without the `write` scope before this handler runs; that is a separate
   * gate.
   */
  private async assertManager(
    workspaceId: string,
    doc: { authorID: number | null },
    req: AuthenticatedRequest,
    verb: 'delete' | 'restore',
  ): Promise<void> {
    const userId = Number(req.user.id);
    const member = await this.workspaceService.assertMember(
      workspaceId,
      userId,
    );
    if (!isDocumentManager(member.role, doc.authorID, userId)) {
      throw new ForbiddenException(
        `Only the workspace owner or document owner can ${verb} this document`,
      );
    }
  }
}
