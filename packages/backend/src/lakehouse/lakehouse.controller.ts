import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedRequest } from 'src/auth/auth.types';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { WorkspaceService } from 'src/workspace/workspace.service';
import {
  CreateLakehouseSourceDto,
  LakehouseHistoryQueryDto,
  ReadLakehouseDto,
  UpdateLakehouseSourceDto,
} from './lakehouse.dto';
import { LakehouseService } from './lakehouse.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class LakehouseController {
  constructor(
    private readonly lakehouseService: LakehouseService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  @Post('workspaces/:workspaceId/lakehouse-sources')
  async create(
    @Param('workspaceId') workspaceIdOrSlug: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateLakehouseSourceDto,
  ) {
    const userId = Number(request.user.id);
    const workspaceId =
      await this.workspaceService.resolveId(workspaceIdOrSlug);
    await this.workspaceService.assertMember(workspaceId, userId);
    return this.lakehouseService.create(userId, workspaceId, dto);
  }

  @Get('workspaces/:workspaceId/lakehouse-sources')
  async findAll(
    @Param('workspaceId') workspaceIdOrSlug: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const userId = Number(request.user.id);
    const workspaceId =
      await this.workspaceService.resolveId(workspaceIdOrSlug);
    await this.workspaceService.assertMember(workspaceId, userId);
    return this.lakehouseService.findAllByWorkspace(workspaceId);
  }

  @Post('workspaces/:workspaceId/lakehouse-sources/test')
  async testConfiguration(
    @Param('workspaceId') workspaceIdOrSlug: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: CreateLakehouseSourceDto,
  ) {
    const userId = Number(request.user.id);
    const workspaceId =
      await this.workspaceService.resolveId(workspaceIdOrSlug);
    await this.workspaceService.assertMember(workspaceId, userId);
    return this.lakehouseService.testConfiguration(dto);
  }

  @Get('lakehouse-sources/:id')
  async findOne(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    await this.assertSourceMember(id, request);
    return this.lakehouseService.findOne(id);
  }

  @Patch('lakehouse-sources/:id')
  async update(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateLakehouseSourceDto = {},
  ) {
    await this.assertSourceMember(id, request);
    return this.lakehouseService.update(id, dto);
  }

  @Delete('lakehouse-sources/:id')
  async remove(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    await this.assertSourceMember(id, request);
    return this.lakehouseService.remove(id);
  }

  @Post('lakehouse-sources/:id/test')
  async testConnection(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateLakehouseSourceDto = {},
  ) {
    await this.assertSourceMember(id, request);
    return this.lakehouseService.testConnection(id, dto);
  }

  @Get('lakehouse-sources/:id/tables')
  async tables(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    await this.assertSourceMember(id, request);
    return this.lakehouseService.tables(id);
  }

  @Get('lakehouse-sources/:id/history')
  async history(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    @Query() query: LakehouseHistoryQueryDto,
  ) {
    await this.assertSourceMember(id, request);
    return this.lakehouseService.history(id, query.limit);
  }

  @Post('lakehouse-sources/:id/read')
  async read(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    @Body() dto: ReadLakehouseDto = {},
  ) {
    await this.assertSourceMember(id, request);
    return this.lakehouseService.read(id, dto);
  }

  private async assertSourceMember(
    id: string,
    request: AuthenticatedRequest,
  ): Promise<void> {
    const source = await this.lakehouseService.findRaw(id);
    await this.workspaceService.assertMember(
      source.workspaceId,
      Number(request.user.id),
    );
  }
}
