import { Module } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotificationController } from './notification.controller';
import { NotificationHub } from './notification-hub';
import { NotificationService } from './notification.service';

/**
 * Deliberately does **not** import `WorkspaceModule`. `WorkspaceService`
 * calls into `NotificationService` when an invite is accepted, so depending
 * on it here would close a cycle; the one membership lookup this module needs
 * goes through Prisma directly.
 */
@Module({
  controllers: [NotificationController],
  providers: [NotificationService, NotificationHub, PrismaService],
  exports: [NotificationService],
})
export class NotificationModule {}
