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
import { CreateApiKeyDto } from './api-key.dto';

/**
 * API keys are minted by any workspace **member**, not just the owner.
 *
 * A key authenticates as the user who created it (`ApiKeyStrategy` reads
 * `createdBy` into the request identity) and `WorkspaceScopeGuard` re-checks
 * that membership on every request, so a member's key carries exactly the
 * authority that member already holds in the web UI — and `/api/v1` exposes no
 * workspace administration for it to reach. Gating minting on ownership
 * therefore bought no safety; it only shut members out of the CLI and the v1
 * API.
 *
 * Visibility and revocation are scoped by creator instead: a member sees and
 * revokes their own keys, an owner administers every key in the workspace.
 */
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
    @Body() body: CreateApiKeyDto,
  ) {
    const userId = Number(req.user.id);
    const resolvedId = await this.workspaceService.resolveId(workspaceId);
    await this.workspaceService.assertMember(resolvedId, userId);
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
    const scope = await this.keyScope(resolvedId, userId);
    return this.apiKeyService.list(resolvedId, scope);
  }

  @Delete(':id')
  async revoke(
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = Number(req.user.id);
    const resolvedId = await this.workspaceService.resolveId(workspaceId);
    const scope = await this.keyScope(resolvedId, userId);
    return this.apiKeyService.revoke(id, resolvedId, scope);
  }

  /**
   * Asserts membership and returns which keys this caller may see and revoke:
   * every key for an owner, their own for anyone else.
   *
   * `assertMember` already returns the member row, so the role comes out of
   * the same query that authorized the request rather than a second one.
   */
  private async keyScope(resolvedId: string, userId: number) {
    const member = await this.workspaceService.assertMember(resolvedId, userId);
    return member.role === 'owner' ? {} : { createdBy: userId };
  }
}
