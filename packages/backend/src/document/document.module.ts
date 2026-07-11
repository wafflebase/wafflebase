import { Module } from '@nestjs/common';
import { DocumentController } from './document.controller';
import { DocumentFileController } from './document-file.controller';
import { YorkieEventController } from './yorkie-event.controller';
import { YorkieSignatureGuard } from './yorkie-signature.guard';
import { DocumentService } from './document.service';
import { UserService } from 'src/user/user.service';
import { PrismaService } from 'src/database/prisma.service';
import { WorkspaceModule } from '../workspace/workspace.module';
import { FileModule } from '../file/file.module';
import { ShareLinkModule } from '../share-link/share-link.module';

@Module({
  imports: [WorkspaceModule, FileModule, ShareLinkModule],
  controllers: [
    DocumentController,
    DocumentFileController,
    YorkieEventController,
  ],
  providers: [
    DocumentService,
    UserService,
    PrismaService,
    YorkieSignatureGuard,
  ],
})
export class DocumentModule {}
