import { Module } from '@nestjs/common';
import { ApiKeyModule } from '../api-key/api-key.module';
import { PrismaService } from '../database/prisma.service';
import { WebhookEventModule } from '../webhook/webhook-event.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { BotController, BotPairingController } from './bot.controller';
import { BotService } from './bot.service';

@Module({
  imports: [WorkspaceModule, ApiKeyModule, WebhookEventModule],
  controllers: [BotController, BotPairingController],
  providers: [BotService, PrismaService],
  exports: [BotService],
})
export class BotModule {}
