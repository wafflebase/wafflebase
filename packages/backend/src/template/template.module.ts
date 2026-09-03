import { Module } from '@nestjs/common';
import { TemplateController } from './template.controller';
import { TemplateService } from './template.service';
import { TemplateReviewerGuard } from './template-reviewer.guard';
import { PrismaService } from 'src/database/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { DocumentModule } from '../document/document.module';
import { ShareLinkModule } from '../share-link/share-link.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { FolderModule } from '../folder/folder.module';
import { ImageModule } from '../image/image.module';
import { NotificationModule } from '../notification/notification.module';

/**
 * The template gallery (docs/design/template-gallery.md). It owns no engine of
 * its own: publishing mints a `ShareLinkModule` viewer link and using a
 * template is `DocumentModule`'s copy service pointed at another workspace.
 */
@Module({
  imports: [
    AuthModule,
    DocumentModule,
    ShareLinkModule,
    WorkspaceModule,
    FolderModule,
    // Thumbnails are ordinary image-bucket objects, so withdrawing or
    // replacing one is this module's job to clean up.
    ImageModule,
    // A review decision notifies the publisher. Safe to import — the
    // dependency runs one way, unlike `WorkspaceModule`'s.
    NotificationModule,
  ],
  controllers: [TemplateController],
  providers: [TemplateService, TemplateReviewerGuard, PrismaService],
  exports: [TemplateService],
})
export class TemplateModule {}
