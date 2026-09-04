import { Module } from '@nestjs/common';
import { ApiV1DocumentsController } from './documents.controller';
import { ApiV1TabsController } from './tabs.controller';
import { ApiV1CellsController } from './cells.controller';
import { ApiV1WorksheetController } from './worksheet.controller';
import { ApiV1WorksheetRulesController } from './worksheet-rules.controller';
import { ApiV1WorksheetFilterPivotController } from './worksheet-filter-pivot.controller';
import { ApiV1WorksheetStylesController } from './worksheet-styles.controller';
import { ApiV1WorksheetDimensionsController } from './worksheet-dimensions.controller';
import { ApiV1WorksheetChartsController } from './worksheet-charts.controller';
import { ApiV1WorksheetStructureController } from './worksheet-structure.controller';
import { ApiV1DocsContentController } from './docs-content.controller';
import { ApiV1CommentsController } from './comments.controller';
import { ApiV1SlidesController } from './slides.controller';
import { ApiV1WorksheetImagesController } from './worksheet-images.controller';
import { ApiV1ImagesController } from './images.controller';
import { ApiV1ImageReadController } from './image-read.controller';
import { ApiV1FilesController } from './files.controller';
import { ApiV1FoldersController } from './folders.controller';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { DocumentService } from '../../document/document.service';
import { PrismaService } from '../../database/prisma.service';
import { WorkspaceModule } from '../../workspace/workspace.module';
import { ApiKeyModule } from '../../api-key/api-key.module';
import { ImageModule } from '../../image/image.module';
import { FileModule } from '../../file/file.module';
import { FolderModule } from '../../folder/folder.module';
// For `DocumentCopyService` — `POST /documents/:id/copy` runs the same engine
// the web "Make a copy" does rather than a second implementation of it.
import { DocumentModule } from '../../document/document.module';
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
    DocumentModule,
    ShareLinkModule,
  ],
  controllers: [
    ApiV1DocumentsController,
    ApiV1TabsController,
    ApiV1CellsController,
    ApiV1WorksheetController,
    ApiV1WorksheetRulesController,
    ApiV1WorksheetFilterPivotController,
    ApiV1WorksheetStylesController,
    ApiV1WorksheetDimensionsController,
    ApiV1WorksheetChartsController,
    ApiV1WorksheetStructureController,
    ApiV1WorksheetImagesController,
    ApiV1DocsContentController,
    ApiV1CommentsController,
    ApiV1SlidesController,
    ApiV1ImagesController,
    ApiV1ImageReadController,
    ApiV1FilesController,
    ApiV1FoldersController,
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
