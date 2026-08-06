import { Module } from '@nestjs/common';
import { FileImportController } from './file-import.controller';
import { FileImportService } from './file-import.service';
import { FileModule } from '../file/file.module';
import { LakehouseModule } from '../lakehouse/lakehouse.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { WorkspaceScopeGuard } from '../api/v1/workspace-scope.guard';

@Module({
  imports: [FileModule, LakehouseModule, WorkspaceModule],
  controllers: [FileImportController],
  providers: [FileImportService, WorkspaceScopeGuard],
})
export class FileImportModule {}
