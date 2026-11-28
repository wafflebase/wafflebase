import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ApiKeyWriteScopeGuard } from './api-key-write-scope.guard';
import { AuthenticatedRequest } from '../../auth/auth.types';
import { AgentTaskService } from '../../agent/agent-task.service';
import { AgentTaskDto } from '../../agent/agent-task.types';
import {
  CompleteTaskDto,
  NextTaskQueryDto,
  ReplyTaskDto,
} from '../../agent/agent-task.dto';
import { ChatMessageDto } from '../../chat/chat.types';
import { UserThrottlerGuard } from '../../notification/user-throttler.guard';

/**
 * The pace of a bot's replies: the bound `ChatController` puts on a
 * person's posts, keyed on the bot.
 */
const REPLY_THROTTLE = { default: { ttl: 10_000, limit: 30 } };

/**
 * A bot's work queue (`docs/design/agent-runner.md`, MVP long-poll): claim
 * the next task, read its thread, answer in it, finish it. Called by a host
 * the bot was paired to (`wafflebase agent next|thread|reply|complete`),
 * with the key that pairing minted.
 *
 * Nested under the workspace so `WorkspaceScopeGuard` binds the key to it.
 * Every route then refuses anybody who is not a bot (403): a person's key
 * has no queue. A task of another bot is 404, as an unknown one is.
 */
@Controller('api/v1/workspaces/:workspaceId/agent/tasks')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard, ApiKeyWriteScopeGuard)
export class ApiV1AgentTasksController {
  constructor(private readonly tasks: AgentTaskService) {}

  /**
   * Long-poll for the next task, up to `wait` seconds. The wait is dropped
   * the moment the client hangs up, so an abandoned poll neither claims a
   * task nobody will receive nor keeps its waiter.
   */
  @Get('next')
  async next(
    @Param('workspaceId') workspaceId: string,
    @Query() query: NextTaskQueryDto,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ task: AgentTaskDto | null }> {
    const botId = Number(req.user.id);
    await this.tasks.assertBot(botId);
    const hangup = new AbortController();
    const onClose = () => hangup.abort();
    res.on('close', onClose);
    try {
      const task = await this.tasks.next(
        botId,
        workspaceId,
        (query.wait ?? 0) * 1_000,
        hangup.signal,
        req.user.apiKeyId,
      );
      return { task };
    } finally {
      res.off('close', onClose);
    }
  }

  @Get(':taskId/thread')
  async thread(
    @Param('workspaceId') workspaceId: string,
    @Param('taskId') taskId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ChatMessageDto[]> {
    const botId = Number(req.user.id);
    await this.tasks.assertBot(botId);
    return this.tasks.thread(botId, workspaceId, taskId);
  }

  @Post(':taskId/reply')
  @UseGuards(UserThrottlerGuard)
  @Throttle(REPLY_THROTTLE)
  async reply(
    @Param('workspaceId') workspaceId: string,
    @Param('taskId') taskId: string,
    @Body() dto: ReplyTaskDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ChatMessageDto> {
    const botId = Number(req.user.id);
    await this.tasks.assertBot(botId);
    return this.tasks.reply(
      botId,
      workspaceId,
      taskId,
      dto.body,
      req.user.apiKeyId,
    );
  }

  @Post(':taskId/complete')
  @HttpCode(204)
  async complete(
    @Param('workspaceId') workspaceId: string,
    @Param('taskId') taskId: string,
    @Body() dto: CompleteTaskDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    const botId = Number(req.user.id);
    await this.tasks.assertBot(botId);
    await this.tasks.complete(
      botId,
      workspaceId,
      taskId,
      dto.status,
      req.user.apiKeyId,
    );
  }
}
