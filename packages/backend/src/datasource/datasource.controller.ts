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

@Controller('datasources')
@UseGuards(JwtAuthGuard)
export class DataSourceController {
  constructor(private readonly datasourceService: DataSourceService) {}

  @Post()
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateDataSourceDto,
  ) {
    return this.datasourceService.create(Number(req.user.id), dto);
  }

  @Get()
  async findAll(@Req() req: AuthenticatedRequest) {
    return this.datasourceService.findAll(Number(req.user.id));
  }

  @Get(':id')
  async findOne(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.datasourceService.findOne(Number(req.user.id), id);
  }

  @Patch(':id')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateDataSourceDto,
  ) {
    return this.datasourceService.update(Number(req.user.id), id, dto);
  }

  @Delete(':id')
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.datasourceService.remove(Number(req.user.id), id);
  }

  @Post(':id/test')
  async testConnection(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.datasourceService.testConnection(Number(req.user.id), id);
  }

  @Post(':id/query')
  async executeQuery(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: ExecuteQueryDto,
  ) {
    return this.datasourceService.executeQuery(Number(req.user.id), id, dto);
  }
}
