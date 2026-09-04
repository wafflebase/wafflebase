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
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ApiKeyWriteScopeGuard } from './api-key-write-scope.guard';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { isDocumentManager } from '../../document/document-access';
import { WorkspaceService } from '../../workspace/workspace.service';
import { FolderService } from '../../folder/folder.service';
import { CreateFolderDto, UpdateFolderDto } from '../../folder/folder.dto';

/**
 * The workspace folder tree, reachable without a browser.
 *
 * The web surface (`folder.controller.ts`) is `JwtAuthGuard` on a bare
 * `@Controller()`, so an API key cannot call it at all — the class-A′ gap in
 * docs/design/agentic-office-workflow.md. This is the same tree under
 * `/api/v1`, and the routes are **nested under the workspace** rather than
 * copied as `folders/:id`: `WorkspaceScopeGuard` is what refuses a key minted
 * for a different workspace, and it has nothing to check when the workspace is
 * absent from the path.
 *
 * The web routes are left exactly as they are. The frontend calls them, and
 * closing this gap must not change what a browser session can do.
 */
@Controller('api/v1/workspaces/:workspaceId/folders')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard, ApiKeyWriteScopeGuard)
export class ApiV1FoldersController {
  constructor(
    private readonly folderService: FolderService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  /**
   * The folder, or `404` — including when it exists in another workspace.
   *
   * Not `403`: which folders another workspace holds is that workspace's
   * information, and the same shape `getDocumentOrThrow` uses for a document
   * outside the route's workspace.
   */
  private async folderInWorkspace(
    folderId: string,
    workspaceId: string,
  ): Promise<Folder> {
    const folder = await this.folderService.getById(folderId);
    if (!folder || folder.workspaceId !== workspaceId) {
      throw new NotFoundException('Folder not found');
    }
    return folder;
  }

  /**
   * Whether the caller may move or delete this folder — the same manager bar
   * the web surface applies: workspace owner, or the folder's author.
   *
   * An API key is **not** waved through. It carries the authority of the user
   * who minted it (`ApiKeyStrategy` puts that id on `req.user`), resolved
   * against their membership *now* rather than at mint time, so a key does not
   * outlive its minter's role. Since a key can only be minted by a workspace
   * owner (`assertOwner`), this costs a live owner's key nothing and denies one
   * whose minter was demoted or removed. The `write` scope
   * (`ApiKeyWriteScopeGuard`) is a separate, earlier gate.
   */
  private async isManager(
    folder: Folder,
    req: AuthenticatedRequest,
  ): Promise<boolean> {
    const userId = Number(req.user.id);
    const member = await this.workspaceService.assertMember(
      folder.workspaceId,
      userId,
    );
    return isDocumentManager(member.role, folder.authorID, userId);
  }

  @Post()
  async create(
    @Param('workspaceId') workspaceId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateFolderDto,
  ): Promise<Folder> {
    if (body.parentId) {
      await this.folderService.assertSameWorkspace(body.parentId, workspaceId);
    }
    return this.folderService.create({
      name: body.name,
      workspaceId,
      parentId: body.parentId ?? null,
      // An API key has no user behind it, so the folder is authored by the
      // user who minted the key — `ApiKeyStrategy` puts that id on `req.user`.
      authorID: Number(req.user.id),
    });
  }

  @Get()
  async list(@Param('workspaceId') workspaceId: string) {
    return this.folderService.listByWorkspace(workspaceId);
  }

  @Patch(':folderId')
  async update(
    @Param('workspaceId') workspaceId: string,
    @Param('folderId') folderId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateFolderDto,
  ): Promise<Folder> {
    const folder = await this.folderInWorkspace(folderId, workspaceId);

    const data: { name?: string; parentId?: string | null } = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.parentId !== undefined) {
      // Renaming is an edit any member may do; moving is manager-only, the
      // same split the web surface draws.
      if (!(await this.isManager(folder, req))) {
        throw new ForbiddenException(
          'Only the workspace owner or folder owner can move this folder',
        );
      }
      const nextParent = body.parentId; // string | null
      if (nextParent !== null) {
        await this.folderService.assertSameWorkspace(nextParent, workspaceId);
      }
      await this.folderService.assertNoCycle(folderId, nextParent);
      data.parentId = nextParent;
    }
    return this.folderService.update(folderId, data);
  }

  @Delete(':folderId')
  async remove(
    @Param('workspaceId') workspaceId: string,
    @Param('folderId') folderId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Folder> {
    const folder = await this.folderInWorkspace(folderId, workspaceId);
    if (!(await this.isManager(folder, req))) {
      throw new ForbiddenException(
        'Only the workspace owner or folder owner can delete this folder',
      );
    }
    // Non-destructive by schema: descendant folders cascade, but their
    // documents are `SetNull` and return to the workspace root.
    return this.folderService.delete(folderId);
  }
}
