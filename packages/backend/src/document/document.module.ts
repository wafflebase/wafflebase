import { Module } from '@nestjs/common';
import { DocumentController } from './document.controller';
import { DocumentFileController } from './document-file.controller';
import { YorkieEventController } from './yorkie-event.controller';
import { YorkieAuthController } from './yorkie-auth.controller';
import { YorkieSignatureGuard } from './yorkie-signature.guard';
import { DocumentService } from './document.service';
import { UserService } from 'src/user/user.service';
import { PrismaService } from 'src/database/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { FileModule } from '../file/file.module';
import { ShareLinkModule } from '../share-link/share-link.module';
import { FolderModule } from '../folder/folder.module';

@Module({
  imports: [AuthModule, WorkspaceModule, FileModule, ShareLinkModule, FolderModule],
  controllers: [
    DocumentController,
    DocumentFileController,
    YorkieEventController,
    YorkieAuthController,
  ],
  providers: [
    DocumentService,
    UserService,
    PrismaService,
    YorkieSignatureGuard,
  ],
})
export class DocumentModule {}
