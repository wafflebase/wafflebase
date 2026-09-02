import { Module } from '@nestjs/common';
import { DocumentController } from './document.controller';
import { DocumentFileController } from './document-file.controller';
import { YorkieEventController } from './yorkie-event.controller';
import { YorkieAuthController } from './yorkie-auth.controller';
import { YorkieSignatureGuard } from './yorkie-signature.guard';
import { DocumentService } from './document.service';
import { DocumentCopyService } from './document-copy.service';
import { UserService } from 'src/user/user.service';
import { PrismaService } from 'src/database/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { FileModule } from '../file/file.module';
import { ShareLinkModule } from '../share-link/share-link.module';
import { FolderModule } from '../folder/folder.module';
import { ImageModule } from '../image/image.module';
import { TemplateSyncModule } from '../template/template-sync.module';

@Module({
  imports: [
    AuthModule,
    WorkspaceModule,
    FileModule,
    ShareLinkModule,
    FolderModule,
    // A copy that crosses a workspace boundary re-hosts the source's
    // workspace-scoped images (docs/design/template-gallery.md).
    ImageModule,
    // The Yorkie edit webhook returns an approved public listing to review.
    // A dedicated module rather than `TemplateModule`, which imports this one.
    TemplateSyncModule,
  ],
  controllers: [
    DocumentController,
    DocumentFileController,
    YorkieEventController,
    YorkieAuthController,
  ],
  providers: [
    DocumentService,
    DocumentCopyService,
    UserService,
    PrismaService,
    YorkieSignatureGuard,
  ],
  // The template gallery's "use this template" is this same copy engine with a
  // destination (docs/design/template-gallery.md).
  exports: [DocumentCopyService],
})
export class DocumentModule {}
