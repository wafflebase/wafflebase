import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { DocumentService } from '../../document/document.service';
import { isDocumentManager } from '../../document/document-access';
import { WorkspaceService } from '../../workspace/workspace.service';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { YorkieAdminService } from '../../yorkie/yorkie-admin.service';
import { yorkieDocKey } from '../../yorkie/yorkie-doc-key';

@Controller('api/v1/workspaces/:workspaceId/documents')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard)
export class ApiV1DocumentsController {
  constructor(
    private readonly documentService: DocumentService,
    private readonly yorkieAdminService: YorkieAdminService,
    private readonly workspaceService: WorkspaceService,
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
    @Body() body: { title: string; type?: string },
  ) {
    return this.documentService.createDocument({
      title: body.title,
      type:
        body.type === 'doc' || body.type === 'slides' || body.type === 'note'
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

  @Patch(':documentId')
  async update(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Body() body: { title?: string },
  ) {
    await this.documentService.getDocumentOrThrow({
      id: documentId,
      workspaceId,
    });
    return this.documentService.updateDocument({
      where: { id: documentId },
      data: body,
    });
  }

  @Delete(':documentId')
  async remove(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const doc = await this.documentService.getDocumentOrThrow({
      id: documentId,
      workspaceId,
    });
    if (req.user.isApiKey) {
      // API keys are workspace-scoped credentials minted by an owner; they act
      // with workspace authority but must carry the `write` scope to mutate.
      if (!req.user.scopes?.includes('write')) {
        throw new ForbiddenException(
          'This API key does not have write access',
        );
      }
    } else {
      // A human (JWT) caller may only delete a document they manage — as the
      // workspace owner or the document's author.
      const userId = Number(req.user.id);
      const member = await this.workspaceService.assertMember(
        workspaceId,
        userId,
      );
      if (!isDocumentManager(member.role, doc.authorID, userId)) {
        throw new ForbiddenException(
          'Only the workspace owner or document owner can delete this document',
        );
      }
    }
    return this.documentService.deleteDocument({ id: documentId });
  }
}
