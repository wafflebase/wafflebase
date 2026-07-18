import { Module } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ShareLinkModule } from '../share-link/share-link.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { AnalyticsProducerService } from './analytics-producer.service';
import { AnalyticsWarehouseService } from './analytics-warehouse.service';
import { AnalyticsController } from './analytics.controller';

@Module({
  imports: [ShareLinkModule, WorkspaceModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsProducerService,
    AnalyticsWarehouseService,
    PrismaService,
  ],
  exports: [AnalyticsProducerService, AnalyticsWarehouseService],
})
export class AnalyticsModule {}
