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
  Req,
  UseGuards,
} from '@nestjs/common';
import { Folder } from '@prisma/client';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { AuthenticatedRequest } from 'src/auth/auth.types';
import { WorkspaceService } from '../workspace/workspace.service';
import { isDocumentManager } from '../document/document-access';
import { FolderService } from './folder.service';
import { CreateFolderDto, UpdateFolderDto } from './folder.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class FolderController {
  constructor(
    private readonly folderService: FolderService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  private async resolveFolderManager(
    folder: { workspaceId: string; authorID: number | null },
    userId: number,
  ): Promise<boolean> {
    const member = await this.workspaceService.assertMember(
      folder.workspaceId,
      userId,
    );
    return isDocumentManager(member.role, folder.authorID, userId);
  }

  @Post('workspaces/:workspaceId/folders')
  async create(
    @Param('workspaceId') workspaceIdOrSlug: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateFolderDto,
  ): Promise<Folder> {
    const userId = Number(req.user.id);
    const workspaceId =
      await this.workspaceService.resolveId(workspaceIdOrSlug);
    await this.workspaceService.assertMember(workspaceId, userId);
    if (body.parentId) {
      await this.folderService.assertSameWorkspace(body.parentId, workspaceId);
    }
    return this.folderService.create({
      name: body.name,
      workspaceId,
      parentId: body.parentId ?? null,
      authorID: userId,
    });
  }

  @Get('workspaces/:workspaceId/folders')
  async list(
    @Param('workspaceId') workspaceIdOrSlug: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = Number(req.user.id);
    const workspaceId =
      await this.workspaceService.resolveId(workspaceIdOrSlug);
    await this.workspaceService.assertMember(workspaceId, userId);
    return this.folderService.listByWorkspace(workspaceId);
  }

  @Patch('folders/:id')
  async update(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateFolderDto,
  ): Promise<Folder> {
    const folder = await this.folderService.getById(id);
    if (!folder) throw new NotFoundException('Folder not found');
    const userId = Number(req.user.id);
    const isManager = await this.resolveFolderManager(folder, userId);

    const data: { name?: string; parentId?: string | null } = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.parentId !== undefined) {
      if (!isManager) {
        throw new ForbiddenException(
          'Only the workspace owner or folder owner can move this folder',
        );
      }
      const nextParent = body.parentId; // string | null
      if (nextParent !== null) {
        await this.folderService.assertSameWorkspace(
          nextParent,
          folder.workspaceId,
        );
      }
      await this.folderService.assertNoCycle(id, nextParent);
      data.parentId = nextParent;
    }
    return this.folderService.update(id, data);
  }

  @Delete('folders/:id')
  async remove(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Folder> {
    const folder = await this.folderService.getById(id);
    if (!folder) throw new NotFoundException('Folder not found');
    if (!(await this.resolveFolderManager(folder, Number(req.user.id)))) {
      throw new ForbiddenException(
        'Only the workspace owner or folder owner can delete this folder',
      );
    }
    return this.folderService.delete(id);
  }
}
