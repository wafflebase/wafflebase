import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../auth/auth.types';
import { WorkspaceService } from './workspace.service';
import {
  CreateWorkspaceDto,
  UpdateWorkspaceDto,
  CreateInviteDto,
} from './workspace.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Post('workspaces')
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateWorkspaceDto,
  ) {
    return this.workspaceService.create(Number(req.user.id), body);
  }

  @Get('workspaces')
  async findAll(@Req() req: AuthenticatedRequest) {
    return this.workspaceService.findAllByUser(Number(req.user.id));
  }

  @Get('workspaces/:id')
  async findOne(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.workspaceService.findOne(id, Number(req.user.id));
  }

  @Patch('workspaces/:id')
  async update(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateWorkspaceDto,
  ) {
    return this.workspaceService.update(id, Number(req.user.id), body);
  }

  @Delete('workspaces/:id')
  async remove(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.workspaceService.remove(id, Number(req.user.id));
  }

  @Delete('workspaces/:id/members/:userId')
  async removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.workspaceService.removeMember(
      id,
      Number(req.user.id),
      Number(userId),
    );
  }

  @Post('workspaces/:id/invites')
  async createInvite(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateInviteDto,
  ) {
    return this.workspaceService.createInvite(
      id,
      Number(req.user.id),
      body,
    );
  }

  @Get('workspaces/:id/invites')
  async findInvites(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.workspaceService.findInvites(id, Number(req.user.id));
  }

  @Delete('workspaces/:id/invites/:inviteId')
  async revokeInvite(
    @Param('id') id: string,
    @Param('inviteId') inviteId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.workspaceService.revokeInvite(
      id,
      inviteId,
      Number(req.user.id),
    );
  }

  @Post('invites/:token/accept')
  async acceptInvite(
    @Param('token') token: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.workspaceService.acceptInvite(token, Number(req.user.id));
  }
}
