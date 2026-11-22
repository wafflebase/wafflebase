import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthenticatedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserThrottlerGuard } from '../notification/user-throttler.guard';
import { ChatChannelService } from './chat-channel.service';
import { ChatMessageService } from './chat-message.service';
import {
  AddMembersDto,
  CreateChannelDto,
  EditMessageDto,
  ListMessagesQueryDto,
  MarkReadDto,
  PostMessageDto,
  UpdateChannelDto,
} from './chat.dto';
import { ChannelMember, ChannelSummary, ChatMessageDto } from './chat.types';

/**
 * Workspace chat routes (`docs/design/chat.md` § REST). Every route is
 * scoped by the `:workspaceId` in its path, which may be an id or a slug:
 * a caller outside the workspace, and a channel or message belonging to a
 * different workspace, are both 404.
 */
@Controller('workspaces/:workspaceId/chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private readonly channels: ChatChannelService,
    private readonly messages: ChatMessageService,
  ) {}

  @Get('channels')
  list(
    @Param('workspaceId') workspaceId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ChannelSummary[]> {
    return this.channels.list(Number(req.user.id), workspaceId);
  }

  /** Create a public or private channel, or open (find-or-create) a DM. */
  @Post('channels')
  create(
    @Param('workspaceId') workspaceId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateChannelDto,
  ): Promise<ChannelSummary> {
    const userId = Number(req.user.id);
    if (body.kind === 'dm') {
      return this.channels.openDm(userId, workspaceId, body.userIds ?? []);
    }
    return this.channels.create(userId, workspaceId, {
      kind: body.kind,
      name: body.name!,
      topic: body.topic,
    });
  }

  @Patch('channels/:channelId')
  async update(
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateChannelDto,
  ): Promise<ChannelSummary> {
    const userId = Number(req.user.id);
    await this.channels.resolve(userId, channelId, workspaceId);
    return this.channels.update(userId, channelId, body);
  }

  @Get('channels/:channelId/members')
  async listMembers(
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ChannelMember[]> {
    return this.channels.members(Number(req.user.id), channelId, workspaceId);
  }

  /** No `userIds` (or an empty list) joins the caller; otherwise invites. */
  @Post('channels/:channelId/members')
  async addMembers(
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: AddMembersDto,
  ): Promise<ChannelSummary> {
    const userId = Number(req.user.id);
    await this.channels.resolve(userId, channelId, workspaceId);
    return body.userIds?.length
      ? this.channels.invite(userId, channelId, body.userIds)
      : this.channels.join(userId, channelId);
  }

  @Delete('channels/:channelId/members/me')
  @HttpCode(204)
  async leave(
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    const userId = Number(req.user.id);
    await this.channels.resolve(userId, channelId, workspaceId);
    await this.channels.leave(userId, channelId);
  }

  /**
   * Remove somebody else from a channel. Declared after `members/me` so
   * that route keeps `me`; `ParseIntPipe` would refuse it here anyway.
   */
  @Delete('channels/:channelId/members/:userId')
  @HttpCode(204)
  async removeMember(
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
    @Param('userId', ParseIntPipe) targetId: number,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.channels.removeMember(
      Number(req.user.id),
      channelId,
      targetId,
      workspaceId,
    );
  }

  @Get('channels/:channelId/messages')
  async page(
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
    @Req() req: AuthenticatedRequest,
    @Query() query: ListMessagesQueryDto,
  ): Promise<ChatMessageDto[]> {
    const userId = Number(req.user.id);
    await this.channels.resolve(userId, channelId, workspaceId);
    return this.messages.page(userId, channelId, query);
  }

  /**
   * Throttled per user (`UserThrottlerGuard` keys on the caller, not the
   * address), so a script or a runaway client is bounded at a human pace.
   * The global per-IP bucket still applies on top.
   */
  @Post('channels/:channelId/messages')
  @UseGuards(UserThrottlerGuard)
  @Throttle({ default: { ttl: 10_000, limit: 30 } })
  async post(
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: PostMessageDto,
  ): Promise<ChatMessageDto> {
    const userId = Number(req.user.id);
    await this.channels.resolve(userId, channelId, workspaceId);
    return this.messages.post(userId, channelId, body);
  }

  @Post('channels/:channelId/read')
  @HttpCode(204)
  async markRead(
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: MarkReadDto,
  ): Promise<void> {
    const userId = Number(req.user.id);
    await this.channels.resolve(userId, channelId, workspaceId);
    await this.messages.markRead(userId, channelId, body.seq);
  }

  @Get('messages/:messageId')
  get(
    @Param('workspaceId') workspaceId: string,
    @Param('messageId') messageId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ChatMessageDto> {
    return this.messages.get(Number(req.user.id), messageId, workspaceId);
  }

  @Patch('messages/:messageId')
  edit(
    @Param('workspaceId') workspaceId: string,
    @Param('messageId') messageId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: EditMessageDto,
  ): Promise<ChatMessageDto> {
    return this.messages.edit(
      Number(req.user.id),
      messageId,
      body.body,
      workspaceId,
    );
  }

  @Delete('messages/:messageId')
  @HttpCode(204)
  async remove(
    @Param('workspaceId') workspaceId: string,
    @Param('messageId') messageId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.messages.remove(Number(req.user.id), messageId, workspaceId);
  }
}
