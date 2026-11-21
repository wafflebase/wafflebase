import { Module } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotificationModule } from '../notification/notification.module';
import { ChatBus } from './chat-bus';
import { ChatChannelService } from './chat-channel.service';
import { ChatController } from './chat.controller';
import { ChatHub } from './chat-hub';
import { ChatMessageService } from './chat-message.service';
import { ChatStreamController } from './chat-stream.controller';

/**
 * Workspace chat. Deliberately does **not** import `WorkspaceModule`: the
 * workspace service drops a removed member's chat memberships, so depending
 * on it here would close a cycle (as in `NotificationModule`). Membership
 * checks go through Prisma directly. `NotificationModule` imports no module,
 * so depending on it for mention and thread-reply rows closes no cycle.
 */
@Module({
  imports: [NotificationModule],
  controllers: [ChatController, ChatStreamController],
  providers: [
    ChatBus,
    ChatHub,
    ChatChannelService,
    ChatMessageService,
    PrismaService,
  ],
})
export class ChatModule {}
