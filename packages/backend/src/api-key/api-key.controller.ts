import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import { WorkspaceService } from '../workspace/workspace.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../auth/auth.types';

@Controller('workspaces/:workspaceId/api-keys')
@UseGuards(JwtAuthGuard)
export class ApiKeyController {
  constructor(
    private readonly apiKeyService: ApiKeyService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  @Post()
  async create(
    @Param('workspaceId') workspaceId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: { name: string; scopes?: string[]; expiresAt?: string },
  ) {
    const userId = Number(req.user.id);
    const resolvedId = await this.workspaceService.resolveId(workspaceId);
    await this.workspaceService.assertOwner(resolvedId, userId);
    return this.apiKeyService.create(
      userId,
      resolvedId,
      body.name,
      body.scopes,
      body.expiresAt ? new Date(body.expiresAt) : undefined,
    );
  }

  @Get()
  async list(
    @Param('workspaceId') workspaceId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = Number(req.user.id);
    const resolvedId = await this.workspaceService.resolveId(workspaceId);
    await this.workspaceService.assertMember(resolvedId, userId);
    return this.apiKeyService.list(resolvedId);
  }

  @Delete(':id')
  async revoke(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = Number(req.user.id);
    const resolvedId = await this.workspaceService.resolveId(workspaceId);
    await this.workspaceService.assertOwner(resolvedId, userId);
    return this.apiKeyService.revoke(id, resolvedId);
  }
}
