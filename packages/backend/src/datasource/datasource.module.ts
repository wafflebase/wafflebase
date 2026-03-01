import { Module } from '@nestjs/common';
import { DataSourceController } from './datasource.controller';
import { DataSourceService } from './datasource.service';
import { PrismaService } from 'src/database/prisma.service';
import { WorkspaceModule } from '../workspace/workspace.module';

@Module({
  imports: [WorkspaceModule],
  controllers: [DataSourceController],
  providers: [DataSourceService, PrismaService],
})
export class DataSourceModule {}
