import {
  Req,
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
import { Document as DocumentModel } from '@prisma/client';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { AuthenticatedRequest } from 'src/auth/auth.types';
import { WorkspaceService } from '../workspace/workspace.service';
import {
  CreateDocumentDto,
  CreateDocumentInWorkspaceDto,
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
type DocumentListItem = Omit<DocumentWithAuthor, 'updatedAt'> & {
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
};

@Controller()
@UseGuards(JwtAuthGuard)
export class DocumentController {
  constructor(
    private readonly documentService: DocumentService,
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
    return this.documentService.createDocument({
      title: body.title,
      type: body.type ?? 'sheet',
      fileId: body.fileId,
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
    return this.documentService.createDocument({
      title: body.title,
      type: body.type ?? 'sheet',
      fileId: body.fileId,
      author: { connect: { id: userId } },
      workspace: { connect: { id: body.workspaceId } },
      ...(body.folderId ? { folder: { connect: { id: body.folderId } } } : {}),
    });
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

  @Delete('documents/:id')
  async deleteDocument(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<DocumentModel> {
    const doc = await this.documentService.document({ id });
    if (!doc) {
      throw new NotFoundException('Document not found');
    }
    if (!(await this.resolveDocManager(doc, Number(req.user.id)))) {
      throw new ForbiddenException(
        'Only the workspace owner or document owner can delete this document',
      );
    }
    const deleted = await this.documentService.deleteDocument({ id });
    if (doc.fileId && VALID_FILE_ID_PATTERN.test(doc.fileId)) {
      // Best-effort: a failed blob cleanup must not fail the delete, but log
      // it so an orphaned object has operational visibility.
      await this.fileService.delete(doc.fileId).catch((err) => {
        console.warn(
          `[DocumentController] Failed to delete blob ${doc.fileId}:`,
          err instanceof Error ? err.message : err,
        );
      });
    }
    return deleted;
  }
}
