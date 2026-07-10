import {
  Req,
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
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

type DocumentListItem = Omit<DocumentWithAuthor, 'updatedAt'> & {
  editors?: PresenceUser[];
  // Last-modified time (ISO). Sourced from the Postgres `Document.updatedAt`
  // column, which the Yorkie `DocumentRootChanged` event webhook advances on
  // each edit (see yorkie-event.controller.ts). Stable across requests, unlike
  // the per-request Yorkie admin call — so the list order no longer flips when
  // that call times out.
  updatedAt: string;
};

@Controller()
@UseGuards(JwtAuthGuard)
export class DocumentController {
  constructor(
    private readonly documentService: DocumentService,
    private readonly workspaceService: WorkspaceService,
    private readonly yorkieAdminService: YorkieAdminService,
    private readonly fileService: FileService,
  ) {}

  private async attachMeta(
    docs: DocumentWithAuthor[],
  ): Promise<DocumentListItem[]> {
    if (docs.length === 0) return [];
    // The Yorkie admin call now supplies only the decorative "currently
    // editing" avatars — it is best-effort and its failure/timeout no longer
    // affects ordering, which reads the stable Postgres `updatedAt`.
    const keys = docs.map((d) => yorkieDocKey(d.type, d.id));
    const editorsByKey = await this.yorkieAdminService.getEditors(keys);
    return docs.map((d, i) => {
      const { updatedAt, ...rest } = d;
      const item: DocumentListItem = {
        ...rest,
        updatedAt: updatedAt.toISOString(),
      };
      const editors = editorsByKey.get(keys[i]);
      if (editors?.length) item.editors = editors;
      return item;
    });
  }

  /**
   * Phase-1 contract: only PDF documents carry a `fileId`. Reject a `fileId`
   * on any other type (including the defaulted `sheet`) so blob references
   * can't be attached to editor documents.
   */
  private assertFileIdAllowed(type: string | undefined, fileId?: string): void {
    if (fileId && (type ?? 'sheet') !== 'pdf') {
      throw new BadRequestException('fileId is only allowed for pdf documents');
    }
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
    this.assertFileIdAllowed(body.type, body.fileId);
    return this.documentService.createDocument({
      title: body.title,
      type: body.type ?? 'sheet',
      fileId: body.fileId,
      author: { connect: { id: userId } },
      workspace: { connect: { id: workspaceId } },
    });
  }

  @Get('workspaces/:workspaceId/documents')
  async findByWorkspace(
    @Param('workspaceId') workspaceIdOrSlug: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<DocumentListItem[]> {
    const userId = Number(req.user.id);
    const workspaceId =
      await this.workspaceService.resolveId(workspaceIdOrSlug);
    await this.workspaceService.assertMember(workspaceId, userId);
    const docs = await this.documentService.listDocumentsWithAuthor({
      where: { workspaceId },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return this.attachMeta(docs);
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
    const workspaces = await this.workspaceService.findAllByUser(userId);
    const workspaceIds = workspaces.map((w) => w.id);
    const docs = await this.documentService.listDocumentsWithAuthor({
      where: { workspaceId: { in: workspaceIds } },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return this.attachMeta(docs);
  }

  @Post('documents')
  async createDocument(
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateDocumentInWorkspaceDto,
  ): Promise<DocumentModel> {
    const userId = Number(req.user.id);
    await this.workspaceService.assertMember(body.workspaceId, userId);
    this.assertFileIdAllowed(body.type, body.fileId);
    return this.documentService.createDocument({
      title: body.title,
      type: body.type ?? 'sheet',
      fileId: body.fileId,
      author: { connect: { id: userId } },
      workspace: { connect: { id: body.workspaceId } },
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
    await this.workspaceService.assertMember(doc.workspaceId, userId);

    const data: { title?: string; workspace?: { connect: { id: string } } } =
      {};
    if (body.title !== undefined) {
      data.title = body.title;
    }
    if (body.workspaceId !== undefined) {
      await this.workspaceService.assertMember(body.workspaceId, userId);
      data.workspace = { connect: { id: body.workspaceId } };
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
    await this.workspaceService.assertMember(
      doc.workspaceId,
      Number(req.user.id),
    );
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
