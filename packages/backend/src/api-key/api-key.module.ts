import { Module } from '@nestjs/common';
import { ApiKeyController } from './api-key.controller';
import { ApiKeyService } from './api-key.service';
import { ApiKeyStrategy } from './api-key.strategy';
import { PrismaService } from '../database/prisma.service';
import { WorkspaceModule } from '../workspace/workspace.module';

@Module({
  imports: [WorkspaceModule],
  controllers: [ApiKeyController],
  providers: [ApiKeyService, ApiKeyStrategy, PrismaService],
  exports: [ApiKeyService],
})
export class ApiKeyModule {}
