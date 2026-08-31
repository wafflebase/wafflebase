import { Module } from '@nestjs/common';
import { TemplateController } from './template.controller';
import { TemplateService } from './template.service';
import { PrismaService } from 'src/database/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { DocumentModule } from '../document/document.module';
import { ShareLinkModule } from '../share-link/share-link.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { FolderModule } from '../folder/folder.module';

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
  ],
  controllers: [TemplateController],
  providers: [TemplateService, PrismaService],
  exports: [TemplateService],
})
export class TemplateModule {}
