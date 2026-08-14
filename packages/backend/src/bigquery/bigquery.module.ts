import { Module } from '@nestjs/common';
import { BigQueryController } from './bigquery.controller';
import { BigQueryService } from './bigquery.service';
import { PrismaService } from 'src/database/prisma.service';
import { WorkspaceModule } from '../workspace/workspace.module';

@Module({
  imports: [WorkspaceModule],
  controllers: [BigQueryController],
  providers: [BigQueryService, PrismaService],
})
export class BigQueryModule {}
