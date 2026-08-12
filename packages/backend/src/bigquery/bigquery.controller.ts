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
import { BigQueryService } from './bigquery.service';
import {
  CreateBigQuerySourceDto,
  UpdateBigQuerySourceDto,
  TestBigQueryConnectionDto,
} from './bigquery.dto';
import { ExecuteQueryDto } from '../datasource/datasource.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { AuthenticatedRequest } from 'src/auth/auth.types';
import { WorkspaceService } from '../workspace/workspace.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class BigQueryController {
  constructor(
    private readonly bigQueryService: BigQueryService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  @Post('workspaces/:workspaceId/bigquery')
  async createInWorkspace(
    @Param('workspaceId') workspaceIdOrSlug: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateBigQuerySourceDto,
  ) {
    const userId = Number(req.user.id);
    const workspaceId =
      await this.workspaceService.resolveId(workspaceIdOrSlug);
    await this.workspaceService.assertMember(workspaceId, userId);
    return this.bigQueryService.create(userId, workspaceId, dto);
  }

  /**
   * Validate connection settings without saving them, so the creation
   * dialog can test a connection before the source exists.
   */
  @Post('workspaces/:workspaceId/bigquery/test')
  async testConfigInWorkspace(
    @Param('workspaceId') workspaceIdOrSlug: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: TestBigQueryConnectionDto,
  ) {
    const userId = Number(req.user.id);
    const workspaceId =
      await this.workspaceService.resolveId(workspaceIdOrSlug);
    await this.workspaceService.assertMember(workspaceId, userId);
    return this.bigQueryService.testConfig(dto);
  }

  @Get('workspaces/:workspaceId/bigquery')
  async findByWorkspace(
    @Param('workspaceId') workspaceIdOrSlug: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = Number(req.user.id);
    const workspaceId =
      await this.workspaceService.resolveId(workspaceIdOrSlug);
    await this.workspaceService.assertMember(workspaceId, userId);
    return this.bigQueryService.findAllByWorkspace(workspaceId);
  }

  @Get('bigquery/:id')
  async findOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const source = await this.bigQueryService.findRaw(id);
    await this.workspaceService.assertMember(
      source.workspaceId,
      Number(req.user.id),
    );
    return this.bigQueryService.findOne(id);
  }

  @Patch('bigquery/:id')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateBigQuerySourceDto,
  ) {
    const source = await this.bigQueryService.findRaw(id);
    await this.workspaceService.assertMember(
      source.workspaceId,
      Number(req.user.id),
    );
    return this.bigQueryService.update(id, dto);
  }

  @Delete('bigquery/:id')
  async remove(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const source = await this.bigQueryService.findRaw(id);
    await this.workspaceService.assertMember(
      source.workspaceId,
      Number(req.user.id),
    );
    return this.bigQueryService.remove(id);
  }

  @Post('bigquery/:id/test')
  async testConnection(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const source = await this.bigQueryService.findRaw(id);
    await this.workspaceService.assertMember(
      source.workspaceId,
      Number(req.user.id),
    );
    return this.bigQueryService.testConnection(id);
  }

  @Post('bigquery/:id/query')
  async executeQuery(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: ExecuteQueryDto,
  ) {
    const source = await this.bigQueryService.findRaw(id);
    await this.workspaceService.assertMember(
      source.workspaceId,
      Number(req.user.id),
    );
    return this.bigQueryService.executeQuery(id, dto);
  }
}
