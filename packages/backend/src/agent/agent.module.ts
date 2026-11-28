import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { PrismaService } from '../database/prisma.service';
import { AgentTaskService } from './agent-task.service';

/**
 * Agent tasks: the work queue a bot's host drains
 * (`docs/design/agent-runner.md`). Depends on chat for reading threads and
 * posting replies; chat creates the tasks itself with Prisma and never
 * imports this module, so there is no cycle. The routes are under `/api/v1`
 * (`ApiV1AgentTasksController`), mounted by `ApiV1Module`.
 */
@Module({
  imports: [ChatModule],
  providers: [AgentTaskService, PrismaService],
  exports: [AgentTaskService],
})
export class AgentModule {}
