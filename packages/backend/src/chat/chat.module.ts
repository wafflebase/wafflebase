import { Module } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ChatBus } from './chat-bus';

/**
 * Workspace chat. Deliberately does **not** import `WorkspaceModule`: the
 * workspace service drops a removed member's chat memberships, so depending
 * on it here would close a cycle (as in `NotificationModule`). Membership
 * checks go through Prisma directly.
 */
@Module({
  providers: [ChatBus, PrismaService],
})
export class ChatModule {}
