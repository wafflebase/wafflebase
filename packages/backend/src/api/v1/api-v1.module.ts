import { Module } from '@nestjs/common';
import { ApiV1DocumentsController } from './documents.controller';
import { ApiV1TabsController } from './tabs.controller';
import { ApiV1CellsController } from './cells.controller';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { DocumentService } from '../../document/document.service';
import { PrismaService } from '../../database/prisma.service';
import { WorkspaceModule } from '../../workspace/workspace.module';
import { ApiKeyModule } from '../../api-key/api-key.module';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ApiKeyAuthGuard } from '../../api-key/api-key-auth.guard';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';

@Module({
  imports: [WorkspaceModule, ApiKeyModule],
  controllers: [
    ApiV1DocumentsController,
    ApiV1TabsController,
    ApiV1CellsController,
  ],
  providers: [
    DocumentService,
    PrismaService,
    WorkspaceScopeGuard,
    JwtAuthGuard,
    ApiKeyAuthGuard,
    CombinedAuthGuard,
  ],
})
export class ApiV1Module {}
