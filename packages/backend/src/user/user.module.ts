import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { PrismaService } from 'src/database/prisma.service';
import { WebhookEventModule } from '../webhook/webhook-event.module';

@Module({
  imports: [WebhookEventModule],
  providers: [UserService, PrismaService],
  exports: [UserService],
})
export class UserModule {}
