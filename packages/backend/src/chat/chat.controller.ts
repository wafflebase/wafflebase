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
import { ChatDocumentRefService } from './chat-document-refs';
import { ChatMessageService } from './chat-message.service';
import {
  AddMembersDto,
  CreateChannelDto,
  EditMessageDto,
  ListFilesQueryDto,
  ListMessagesQueryDto,
  MarkReadDto,
  PostMessageDto,
  UpdateChannelDto,
} from './chat.dto';
import {
  ChannelMember,
  ChannelSummary,
  ChatFileDto,
  ChatMessageDto,
  ChatSharedInDto,
} from './chat.types';

/**
 * The per-user pace of every route that writes a message: post, edit and
 * delete. Each route keeps its own bucket. An edit is not cheaper than a
 * post — it rewrites bell previews and can add a mention
 * (`NotificationService.syncChatMessage`) — so it gets the same bound rather
 * than none. That also caps the one way an edit can ping somebody
 * repeatedly, toggling a mention out and back in: each ping costs two edits,
 * half the rate a plain post can already mention them at.
 */
const MESSAGE_WRITE_THROTTLE = { default: { ttl: 10_000, limit: 30 } };

/**
 * The per-user pace of the reads that scan a channel's or a document's
 * whole ref set (`files`, `sharedIn`): each page of Files re-sorts every
 * ref in the channel. A person opens the popover, pages it, opens an editor;
 * 120 a minute is far past that. It equals the global per-IP bucket on
 * purpose: `@Throttle` overrides the limit for that bucket too, and a
 * shorter window here (say 60 per 10 s) would *loosen* the per-IP bound to
 * 360 a minute while adding the per-user one.
 */
const REF_READ_THROTTLE = { default: { ttl: 60_000, limit: 120 } };

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
    private readonly documentRefs: ChatDocumentRefService,
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
   * The channel's Files: every live document a message in it links to,
   * once, newest share first. Readable by exactly who can read the messages.
   */
  @Get('channels/:channelId/files')
  @UseGuards(UserThrottlerGuard)
  @Throttle(REF_READ_THROTTLE)
  async files(
    @Param('workspaceId') workspaceId: string,
    @Param('channelId') channelId: string,
    @Req() req: AuthenticatedRequest,
    @Query() query: ListFilesQueryDto,
  ): Promise<{ files: ChatFileDto[]; cursor: string | null }> {
    const { channel } = await this.channels.resolve(
      Number(req.user.id),
      channelId,
      workspaceId,
    );
    return this.documentRefs.files(channel, query);
  }

  /**
   * The channels this document was shared in that the caller belongs to,
   * most recent first: the editor's chat panel opens on the first one when
   * nothing else names a channel (`docs/design/chat.md` § Chat panel).
   */
  @Get('documents/:documentId/channels')
  @UseGuards(UserThrottlerGuard)
  @Throttle(REF_READ_THROTTLE)
  async sharedIn(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ channels: ChatSharedInDto[] }> {
    const userId = Number(req.user.id);
    const { workspaceId: id } = await this.channels.assertWorkspaceMember(
      userId,
      workspaceId,
    );
    return {
      channels: await this.documentRefs.sharedIn(userId, id, documentId),
    };
  }

  /**
   * Throttled per user (`UserThrottlerGuard` keys on the caller, not the
   * address), so a script or a runaway client is bounded at a human pace.
   * The global per-IP bucket still applies on top.
   */
  @Post('channels/:channelId/messages')
  @UseGuards(UserThrottlerGuard)
  @Throttle(MESSAGE_WRITE_THROTTLE)
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

  /** Throttled per user like `post`; see `MESSAGE_WRITE_THROTTLE`. */
  @Patch('messages/:messageId')
  @UseGuards(UserThrottlerGuard)
  @Throttle(MESSAGE_WRITE_THROTTLE)
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

  /** Throttled per user like `post`; see `MESSAGE_WRITE_THROTTLE`. */
  @Delete('messages/:messageId')
  @HttpCode(204)
  @UseGuards(UserThrottlerGuard)
  @Throttle(MESSAGE_WRITE_THROTTLE)
  async remove(
    @Param('workspaceId') workspaceId: string,
    @Param('messageId') messageId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.messages.remove(Number(req.user.id), messageId, workspaceId);
  }
}
