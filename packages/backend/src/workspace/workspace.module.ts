import { Module } from '@nestjs/common';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';
import { PrismaService } from '../database/prisma.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [NotificationModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceService, PrismaService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
