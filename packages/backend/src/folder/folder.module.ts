import { Module } from '@nestjs/common';
import { FolderService } from './folder.service';
import { PrismaService } from 'src/database/prisma.service';

// No controller yet — Task 3 adds the HTTP surface (FolderController) to
// this same module. Registered here first so FolderService is resolvable
// via Nest DI (and moduleRef.get(FolderService) in tests) ahead of that.
@Module({
  providers: [FolderService, PrismaService],
  exports: [FolderService],
})
export class FolderModule {}
