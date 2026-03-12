import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { DocumentService } from '../../document/document.service';
import { AuthenticatedRequest } from '../../auth/auth.types';

@Controller('api/v1/workspaces/:workspaceId/documents')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard)
export class ApiV1DocumentsController {
  constructor(private readonly documentService: DocumentService) {}

  @Get()
  async list(@Param('workspaceId') workspaceId: string) {
    return this.documentService.documents({
      where: { workspaceId },
    });
  }

  @Post()
  async create(
    @Param('workspaceId') workspaceId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: { title: string },
  ) {
    return this.documentService.createDocument({
      title: body.title,
      workspace: { connect: { id: workspaceId } },
      author: { connect: { id: Number(req.user.id) } },
    });
  }

  @Get(':documentId')
  async get(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
  ) {
    const doc = await this.documentService.document({
      id: documentId,
      workspaceId,
    });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  @Patch(':documentId')
  async update(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Body() body: { title?: string },
  ) {
    const doc = await this.documentService.document({
      id: documentId,
      workspaceId,
    });
    if (!doc) throw new NotFoundException('Document not found');
    return this.documentService.updateDocument({
      where: { id: documentId },
      data: body,
    });
  }

  @Delete(':documentId')
  async remove(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
  ) {
    const doc = await this.documentService.document({
      id: documentId,
      workspaceId,
    });
    if (!doc) throw new NotFoundException('Document not found');
    return this.documentService.deleteDocument({ id: documentId });
  }
}
