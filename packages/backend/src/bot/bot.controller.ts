import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedRequest } from '../auth/auth.types';
import { BotService } from './bot.service';
import { CreateBotDto, PairHostDto } from './bot.dto';

/**
 * Settings → Bots and `wafflebase bots …`. A member's session only: a bot's
 * own key authenticates no route here. The workspace may be named by id or
 * slug, as on every other workspace route.
 */
@Controller('workspaces/:workspaceId/bots')
@UseGuards(JwtAuthGuard)
export class BotController {
  constructor(private readonly botService: BotService) {}

  @Get()
  async list(
    @Param('workspaceId') workspaceId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.botService.list(workspaceId, Number(req.user.id));
  }

  @Post()
  async create(
    @Param('workspaceId') workspaceId: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateBotDto,
  ) {
    return this.botService.create(workspaceId, Number(req.user.id), body.name);
  }

  @Delete(':botId')
  @HttpCode(204)
  async remove(
    @Param('workspaceId') workspaceId: string,
    @Param('botId', ParseIntPipe) botId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.botService.remove(workspaceId, Number(req.user.id), botId);
  }

  @Post(':botId/pairing-codes')
  async createPairingCode(
    @Param('workspaceId') workspaceId: string,
    @Param('botId', ParseIntPipe) botId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.botService.createPairingCode(
      workspaceId,
      Number(req.user.id),
      botId,
    );
  }
}

/**
 * `POST /auth/pair`: a host redeems a pairing code for its bot API key.
 * Unauthenticated, so throttled like the other credential exchanges
 * (`/auth/cli/exchange`, `/auth/refresh`).
 */
@Controller('auth')
export class BotPairingController {
  constructor(private readonly botService: BotService) {}

  @Post('pair')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async pair(@Body() body: PairHostDto) {
    return this.botService.pair(body.code, body.hostName);
  }
}
