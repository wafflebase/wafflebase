import { Module } from '@nestjs/common';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';
import { PrismaService } from '../database/prisma.service';
import { NotificationModule } from '../notification/notification.module';
import { WebhookEventModule } from '../webhook/webhook-event.module';

@Module({
  imports: [NotificationModule, WebhookEventModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceService, PrismaService],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
