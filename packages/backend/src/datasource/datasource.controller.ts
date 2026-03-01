import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { DataSourceService } from './datasource.service';
import {
  CreateDataSourceDto,
  UpdateDataSourceDto,
  ExecuteQueryDto,
} from './datasource.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { AuthenticatedRequest } from 'src/auth/auth.types';
import { WorkspaceService } from '../workspace/workspace.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class DataSourceController {
  constructor(
    private readonly datasourceService: DataSourceService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  // --- Workspace-scoped endpoints ---

  @Post('workspaces/:workspaceId/datasources')
  async createInWorkspace(
    @Param('workspaceId') workspaceId: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateDataSourceDto,
  ) {
    const userId = Number(req.user.id);
    await this.workspaceService.assertMember(workspaceId, userId);
    return this.datasourceService.create(userId, workspaceId, dto);
  }

  @Get('workspaces/:workspaceId/datasources')
  async findByWorkspace(
    @Param('workspaceId') workspaceId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = Number(req.user.id);
    await this.workspaceService.assertMember(workspaceId, userId);
    return this.datasourceService.findAllByWorkspace(workspaceId);
  }

  // --- Legacy / backward-compatible endpoints ---

  @Post('datasources')
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateDataSourceDto & { workspaceId: string },
  ) {
    const userId = Number(req.user.id);
    await this.workspaceService.assertMember(dto.workspaceId, userId);
    return this.datasourceService.create(userId, dto.workspaceId, dto);
  }

  @Get('datasources')
  async findAll(@Req() req: AuthenticatedRequest) {
    const userId = Number(req.user.id);
    const workspaces = await this.workspaceService.findAllByUser(userId);
    const results = await Promise.all(
      workspaces.map((w) => this.datasourceService.findAllByWorkspace(w.id)),
    );
    return results.flat();
  }

  @Get('datasources/:id')
  async findOne(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const ds = await this.datasourceService.findRaw(id);
    await this.workspaceService.assertMember(
      ds.workspaceId,
      Number(req.user.id),
    );
    return this.datasourceService.findOne(id);
  }

  @Patch('datasources/:id')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateDataSourceDto,
  ) {
    const ds = await this.datasourceService.findRaw(id);
    await this.workspaceService.assertMember(
      ds.workspaceId,
      Number(req.user.id),
    );
    return this.datasourceService.update(id, dto);
  }

  @Delete('datasources/:id')
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const ds = await this.datasourceService.findRaw(id);
    await this.workspaceService.assertMember(
      ds.workspaceId,
      Number(req.user.id),
    );
    return this.datasourceService.remove(id);
  }

  @Post('datasources/:id/test')
  async testConnection(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const ds = await this.datasourceService.findRaw(id);
    await this.workspaceService.assertMember(
      ds.workspaceId,
      Number(req.user.id),
    );
    return this.datasourceService.testConnection(id);
  }

  @Post('datasources/:id/query')
  async executeQuery(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: ExecuteQueryDto,
  ) {
    const ds = await this.datasourceService.findRaw(id);
    await this.workspaceService.assertMember(
      ds.workspaceId,
      Number(req.user.id),
    );
    return this.datasourceService.executeQuery(id, dto);
  }
}
