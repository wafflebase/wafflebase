import { Module } from '@nestjs/common';
import { ApiV1DocumentsController } from './documents.controller';
import { ApiV1TabsController } from './tabs.controller';
import { ApiV1CellsController } from './cells.controller';
import { ApiV1DocsContentController } from './docs-content.controller';
import { ApiV1ImagesController } from './images.controller';
import { ApiV1ImageReadController } from './image-read.controller';
import { ApiV1FilesController } from './files.controller';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { DocumentService } from '../../document/document.service';
import { PrismaService } from '../../database/prisma.service';
import { WorkspaceModule } from '../../workspace/workspace.module';
import { ApiKeyModule } from '../../api-key/api-key.module';
import { ImageModule } from '../../image/image.module';
import { FileModule } from '../../file/file.module';
import { FolderModule } from '../../folder/folder.module';
import { ShareLinkModule } from '../../share-link/share-link.module';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../auth/optional-jwt-auth.guard';
import { ApiKeyAuthGuard } from '../../api-key/api-key-auth.guard';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { OptionalCombinedAuthGuard } from '../../api-key/optional-combined-auth.guard';

@Module({
  imports: [
    WorkspaceModule,
    ApiKeyModule,
    ImageModule,
    FileModule,
    FolderModule,
    ShareLinkModule,
  ],
  controllers: [
    ApiV1DocumentsController,
    ApiV1TabsController,
    ApiV1CellsController,
    ApiV1DocsContentController,
    ApiV1ImagesController,
    ApiV1ImageReadController,
    ApiV1FilesController,
  ],
  providers: [
    DocumentService,
    PrismaService,
    WorkspaceScopeGuard,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    ApiKeyAuthGuard,
    CombinedAuthGuard,
    OptionalCombinedAuthGuard,
  ],
})
export class ApiV1Module {}
