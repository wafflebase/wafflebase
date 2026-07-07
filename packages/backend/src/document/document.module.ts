import { Module } from '@nestjs/common';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { UserService } from 'src/user/user.service';
import { PrismaService } from 'src/database/prisma.service';
import { WorkspaceModule } from '../workspace/workspace.module';
import { FileModule } from '../file/file.module';

@Module({
  imports: [WorkspaceModule, FileModule],
  controllers: [DocumentController],
  providers: [DocumentService, UserService, PrismaService],
})
export class DocumentModule {}
