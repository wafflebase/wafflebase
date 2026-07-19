import { Module } from '@nestjs/common';
import { FolderController } from './folder.controller';
import { FolderService } from './folder.service';
import { PrismaService } from '../database/prisma.service';
import { WorkspaceModule } from '../workspace/workspace.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule, WorkspaceModule],
  controllers: [FolderController],
  providers: [FolderService, PrismaService],
  exports: [FolderService],
})
export class FolderModule {}
