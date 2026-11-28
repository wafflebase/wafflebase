import { Module } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotificationModule } from '../notification/notification.module';
import { ChatAgentTaskTrigger } from './chat-agent-tasks';
import { ChatBus } from './chat-bus';
import { ChatChannelService } from './chat-channel.service';
import { ChatDocumentRefService } from './chat-document-refs';
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
 *
 * Exports the channel and message services for `AgentModule`, whose bot
 * routes read threads and post replies through them. The dependency runs one
 * way only: chat creates tasks with Prisma (`ChatAgentTaskTrigger`) and wakes
 * hosts with a NOTIFY, so it never imports the agent module back.
 */
@Module({
  imports: [NotificationModule],
  controllers: [ChatController, ChatStreamController],
  providers: [
    ChatAgentTaskTrigger,
    ChatBus,
    ChatHub,
    ChatChannelService,
    ChatDocumentRefService,
    ChatMessageService,
    PrismaService,
  ],
  exports: [ChatChannelService, ChatMessageService],
})
export class ChatModule {}
