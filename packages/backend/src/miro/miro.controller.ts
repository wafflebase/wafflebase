import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { AuthenticatedRequest } from 'src/auth/auth.types';
import { WorkspaceService } from '../workspace/workspace.service';
import { MiroService } from './miro.service';
import { ImportMiroBoardDto } from './miro.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class MiroController {
  constructor(
    private readonly miroService: MiroService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  /**
   * Fetch a Miro board's items + connectors on the caller's behalf. The token
   * lives only for this request; the response never contains it.
   */
  @Post('workspaces/:workspaceId/miro/import')
  async importBoard(
    @Param('workspaceId') workspaceIdOrSlug: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: ImportMiroBoardDto,
  ) {
    const userId = Number(req.user.id);
    const workspaceId =
      await this.workspaceService.resolveId(workspaceIdOrSlug);
    await this.workspaceService.assertMember(workspaceId, userId);
    return this.miroService.importBoard(dto.token, dto.boardUrl, workspaceId);
  }
}
