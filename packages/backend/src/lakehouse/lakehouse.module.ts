import { Module } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { WorkspaceModule } from 'src/workspace/workspace.module';
import { DuckDbService } from './duckdb.service';
import { LakehouseController } from './lakehouse.controller';
import { LakehouseService } from './lakehouse.service';

@Module({
  imports: [WorkspaceModule],
  controllers: [LakehouseController],
  providers: [LakehouseService, DuckDbService, PrismaService],
  exports: [DuckDbService],
})
export class LakehouseModule {}
