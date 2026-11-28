import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomInt, randomUUID } from 'node:crypto';
import { ApiKeyService } from '../api-key/api-key.service';
import { announceMembershipRaw } from '../chat/chat-bus';
import { joinDefaultChannel } from '../chat/default-channel';
import { PrismaService } from '../database/prisma.service';
import { WebhookEventService } from '../webhook/webhook-event.service';
import { removeBotsInTx } from '../workspace/bot-teardown';
import { WorkspaceService } from '../workspace/workspace.service';
import type { BotDto, PairingCodeDto, PairResultDto } from './bot.dto';
import { AGENT_SCOPE } from '../api-key/agent-key-scope';

/** A bot's name: also its `username` and what `@` mentions show. */
const BOT_NAME = /^[a-z0-9][a-z0-9-]{1,31}$/;

/** A–Z and 2–9 without the look-alikes 0/O and 1/I: 32 symbols, 5 bits each. */
export const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** How long a pairing code stays redeemable. */
export const PAIRING_CODE_TTL_MS = 10 * 60_000;

const PAIRING_CODE_SHAPE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

/** How many times a taken code is redrawn before the error is the caller's. */
const PAIRING_CODE_ATTEMPTS = 5;

/** `ApiKey.name`'s limit, as `CreateApiKeyDto` enforces it. */
const HOST_NAME_MAX = 100;

const PAIRING_REFUSED = 'Pairing code is invalid, expired, or already used';

/**
 * One `XXXX-XXXX` pairing code. Forty bits from a CSPRNG: with a ten-minute
 * life, single use and a throttled exchange, guessing a live one is out of
 * reach. `pick` is injectable for tests only.
 */
export function generatePairingCode(
  pick: (max: number) => number = randomInt,
): string {
  let code = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) code += '-';
    code += PAIRING_CODE_ALPHABET[pick(PAIRING_CODE_ALPHABET.length)];
  }
  return code;
}

/** The bot columns a `BotDto` is built from, minus its hosts. */
const BOT_USER_SELECT = {
  id: true,
  username: true,
  photo: true,
  botInvokers: true,
  botLastSeenAt: true,
  botOwner: { select: { id: true, username: true } },
} as const satisfies Prisma.UserSelect;

type BotUserRow = Prisma.UserGetPayload<{ select: typeof BOT_USER_SELECT }>;

type HostRow = { id: string; name: string; lastUsedAt: Date | null };

function toBotDto(user: BotUserRow, joinedAt: Date, hosts: HostRow[]): BotDto {
  return {
    id: user.id,
    username: user.username,
    photo: user.photo,
    invokers: user.botInvokers === 'members' ? 'members' : 'owner',
    owner: user.botOwner
      ? { id: user.botOwner.id, username: user.botOwner.username }
      : null,
    // A bot joins its workspace in the transaction that creates it, and
    // `User` has no creation time of its own.
    createdAt: joinedAt.toISOString(),
    lastSeenAt: user.botLastSeenAt?.toISOString() ?? null,
    hosts: hosts.map((key) => ({
      apiKeyId: key.id,
      name: key.name,
      lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    })),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'P2002';
}

/**
 * Bot members: a `User` with `kind: "bot"` in exactly one workspace, driven by
 * an agent host through API keys that only pairing mints. See
 * `docs/design/chat.md` § Bot Members and `docs/design/agent-runner.md` § 1, 4.
 *
 * Any member may create a bot. Managing one — deleting it, handing out a
 * pairing code — is for its owner (`botOwnerId`) and workspace owners.
 */
@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceService: WorkspaceService,
    private readonly apiKeyService: ApiKeyService,
    private readonly webhookEvents: WebhookEventService,
  ) {}

  /** Every active bot of the workspace, oldest first. Any member may list. */
  async list(idOrSlug: string, userId: number): Promise<BotDto[]> {
    const workspaceId = await this.workspaceService.resolveId(idOrSlug);
    await this.workspaceService.assertMember(workspaceId, userId);
    // Through the membership, so a deleted bot — whose `User` row stays for
    // its messages' sake — is not listed.
    const rows = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, user: { kind: 'bot' } },
      orderBy: { joinedAt: 'asc' },
      select: {
        joinedAt: true,
        user: {
          select: {
            ...BOT_USER_SELECT,
            apiKeys: {
              where: { workspaceId, revokedAt: null },
              orderBy: { createdAt: 'asc' },
              select: { id: true, name: true, lastUsedAt: true },
            },
          },
        },
      },
    });
    return rows.map(({ joinedAt, user }) =>
      toBotDto(user, joinedAt, user.apiKeys),
    );
  }

  /**
   * Create a bot owned by the caller: its `User` row and its `member`
   * membership, joined to #general like every member.
   *
   * Names are unique among the workspace's active bots. Nothing in the schema
   * enforces that, so the check and the insert run under a per-workspace
   * advisory lock: two concurrent creates of one name serialize, and the
   * second sees the first.
   */
  async create(
    idOrSlug: string,
    userId: number,
    name: string,
  ): Promise<BotDto> {
    if (!BOT_NAME.test(name)) {
      throw new BadRequestException(
        'Bot name must be 2-32 characters: lowercase letters, digits and ' +
          'hyphens, starting with a letter or digit',
      );
    }
    const workspaceId = await this.workspaceService.resolveId(idOrSlug);
    await this.workspaceService.assertMember(workspaceId, userId);

    const { bot, joinedAt, channelId } = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bot-names:${workspaceId}`}))`;
        const clash = await tx.workspaceMember.findFirst({
          where: {
            workspaceId,
            user: { username: { equals: name, mode: 'insensitive' } },
          },
          select: { userId: true },
        });
        if (clash) {
          throw new ConflictException(
            `A member named "${name}" already exists in this workspace`,
          );
        }

        const bot = await tx.user.create({
          data: {
            kind: 'bot',
            authProvider: 'bot',
            // `.invalid` can never be verified by an OAuth provider, so no
            // sign-in can ever match this row (and `findOrCreateUser`
            // refuses one that did).
            email: `bot-${randomUUID()}@bots.wafflebase.invalid`,
            username: name,
            botOwnerId: userId,
            botWorkspaceId: workspaceId,
            botInvokers: 'owner',
          },
          select: BOT_USER_SELECT,
        });
        const { joinedAt } = await tx.workspaceMember.create({
          data: { workspaceId, userId: bot.id, role: 'member' },
          select: { joinedAt: true },
        });
        const channelId = await joinDefaultChannel(tx, workspaceId, bot.id);
        // Every membership path emits (docs/design/webhooks.md). Unlike an
        // invite, a bot creates no `workspace_member_joined` notification.
        await this.webhookEvents.emitMemberEvent(tx, {
          type: 'member.joined',
          workspaceId,
          actor: userId,
          userId: bot.id,
          role: 'member',
        });
        return { bot, joinedAt, channelId };
      },
    );

    if (channelId) {
      await announceMembershipRaw(this.prisma, [channelId], this.logger);
    }
    return toBotDto(bot, joinedAt, []);
  }

  /**
   * Delete a bot: its membership goes, and with it every key its hosts hold,
   * its unspent pairing codes and its chat memberships here. The `User` row
   * stays so its messages keep their author's name.
   *
   * One transaction, so a key can never outlive a committed removal — the
   * same rule `WorkspaceService.removeMember` follows for people.
   */
  async remove(idOrSlug: string, userId: number, botId: number) {
    const { workspaceId, bot } = await this.manageableBot(
      idOrSlug,
      userId,
      botId,
    );

    const channelIds = await this.prisma.$transaction(async (tx) => {
      const { removed, channelIds } = await removeBotsInTx(
        tx,
        this.webhookEvents,
        { workspaceId, botIds: [bot.id], actor: userId },
      );
      // A concurrent delete got there first.
      if (removed === 0) throw new NotFoundException('Bot not found');
      return channelIds;
    });

    await announceMembershipRaw(this.prisma, channelIds, this.logger);
  }

  /**
   * A single-use code that pairs one host with the bot (`POST /auth/pair`).
   * A new code revokes nothing: earlier codes run out on their own, and the
   * hosts already paired keep running.
   */
  async createPairingCode(
    idOrSlug: string,
    userId: number,
    botId: number,
  ): Promise<PairingCodeDto> {
    const { bot } = await this.manageableBot(idOrSlug, userId, botId);
    const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);

    for (let attempt = 1; ; attempt++) {
      const code = generatePairingCode();
      try {
        await this.prisma.botPairingCode.create({
          data: { code, botId: bot.id, createdBy: userId, expiresAt },
        });
        return { code, expiresAt: expiresAt.toISOString() };
      } catch (error) {
        if (!isUniqueViolation(error) || attempt >= PAIRING_CODE_ATTEMPTS) {
          throw error;
        }
      }
    }
  }

  /**
   * Redeem a pairing code for a fresh API key that authenticates as the bot.
   * Unauthenticated: the code is the whole credential, which is why it is
   * short-lived, single-use and throttled at the route.
   *
   * The code is spent by one conditional update — unused and unexpired — so
   * of two concurrent exchanges exactly one sees a row change, and only that
   * one mints. Unknown, expired and used codes are refused alike.
   */
  async pair(rawCode: string, rawHostName: string): Promise<PairResultDto> {
    const code = rawCode.trim().toUpperCase();
    if (!PAIRING_CODE_SHAPE.test(code)) {
      throw new BadRequestException(PAIRING_REFUSED);
    }

    const now = new Date();
    const { count } = await this.prisma.botPairingCode.updateMany({
      where: { code, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (count === 0) throw new BadRequestException(PAIRING_REFUSED);

    const row = await this.prisma.botPairingCode.findUnique({
      where: { code },
      select: {
        bot: {
          select: {
            id: true,
            username: true,
            kind: true,
            botWorkspaceId: true,
          },
        },
      },
    });
    const bot = row?.bot;
    const workspaceId = bot?.botWorkspaceId;
    // A bot deleted after the code was handed out has no membership left to
    // carry a key's authority.
    const member =
      bot && bot.kind === 'bot' && workspaceId
        ? await this.prisma.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId, userId: bot.id } },
            select: { role: true },
          })
        : null;
    if (!bot || !workspaceId || !member) {
      throw new BadRequestException(PAIRING_REFUSED);
    }

    const hostName =
      rawHostName.trim().slice(0, HOST_NAME_MAX).trim() || 'Unnamed host';
    // `agent`, not read/write: the host reaches the task routes only.
    const key = await this.apiKeyService.create(bot.id, workspaceId, hostName, [
      AGENT_SCOPE,
    ]);
    return {
      botId: bot.id,
      botName: bot.username,
      workspaceId,
      apiKey: key.key,
    };
  }

  /**
   * The bot `botId` of this workspace, if the caller may manage it: its owner
   * or a workspace owner. A user that is not an active bot here answers 404.
   */
  private async manageableBot(idOrSlug: string, userId: number, botId: number) {
    const workspaceId = await this.workspaceService.resolveId(idOrSlug);
    const member = await this.workspaceService.assertMember(
      workspaceId,
      userId,
    );
    const bot = await this.prisma.user.findFirst({
      where: {
        id: botId,
        kind: 'bot',
        botWorkspaceId: workspaceId,
        workspaceMembers: { some: { workspaceId } },
      },
      select: { id: true, botOwnerId: true },
    });
    if (!bot) throw new NotFoundException('Bot not found');
    if (bot.botOwnerId !== userId && member.role !== 'owner') {
      throw new ForbiddenException(
        "Only the bot's owner or a workspace owner can manage it",
      );
    }
    return { workspaceId, bot };
  }
}
