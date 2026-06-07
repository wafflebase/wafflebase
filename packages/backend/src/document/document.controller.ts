import {
  Req,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { DocumentService } from './document.service';
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

type DocumentListItem = DocumentModel & {
  editors?: PresenceUser[];
};

@Controller()
@UseGuards(JwtAuthGuard)
export class DocumentController {
  constructor(
    private readonly documentService: DocumentService,
    private readonly workspaceService: WorkspaceService,
    private readonly yorkieAdminService: YorkieAdminService,
  ) {}

  private async attachEditors(
    docs: DocumentModel[],
  ): Promise<DocumentListItem[]> {
    if (docs.length === 0) return [];
    const keys = docs.map((d) => yorkieDocKey(d.type, d.id));
    const editorsByKey = await this.yorkieAdminService.getEditors(keys);
    return docs.map((d, i) => {
      const editors = editorsByKey.get(keys[i]);
      return editors ? { ...d, editors } : d;
    });
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
    return this.documentService.createDocument({
      title: body.title,
      type: body.type ?? 'sheet',
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
    const docs = await this.documentService.documents({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
    return this.attachEditors(docs);
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
    const docs = await this.documentService.documents({
      where: { workspaceId: { in: workspaceIds } },
      orderBy: { createdAt: 'desc' },
    });
    return this.attachEditors(docs);
  }

  @Post('documents')
  async createDocument(
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateDocumentInWorkspaceDto,
  ): Promise<DocumentModel> {
    const userId = Number(req.user.id);
    await this.workspaceService.assertMember(body.workspaceId, userId);
    return this.documentService.createDocument({
      title: body.title,
      type: body.type ?? 'sheet',
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
    return this.documentService.deleteDocument({ id });
  }
}
