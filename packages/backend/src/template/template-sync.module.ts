import { Module } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { NotificationModule } from '../notification/notification.module';
import { TemplateReviewSyncService } from './template-review-sync.service';

/**
 * The one piece of template logic `DocumentModule` needs, packaged so it can
 * have it without a cycle.
 *
 * `TemplateModule` imports `DocumentModule` (for `DocumentCopyService`), so
 * `DocumentModule` cannot import `TemplateModule` back. This module holds only
 * the Yorkie-edit → re-review rule and depends on nothing from `DocumentModule`
 * — the same shape `NotificationModule` uses to stay out of `WorkspaceModule`'s
 * cycle, and for the same reason.
 */
@Module({
  imports: [NotificationModule],
  providers: [TemplateReviewSyncService, PrismaService],
  exports: [TemplateReviewSyncService],
})
export class TemplateSyncModule {}
