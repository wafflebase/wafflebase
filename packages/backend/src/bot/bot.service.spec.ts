import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  BotService,
  generatePairingCode,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_TTL_MS,
} from './bot.service';

const WS = '11111111-1111-1111-1111-111111111111';
const OWNER = 1; // workspace owner
const ALICE = 2; // an ordinary member, the bot's owner
const BOB = 3; // another ordinary member
const BOT = 50;

const JOINED = new Date('2026-11-28T10:00:00.000Z');

/** The row `loadBot` sees for an active bot of `WS` owned by Alice. */
const botRow = (over: Record<string, unknown> = {}) => ({
  id: BOT,
  username: 'deck-bot',
  kind: 'bot',
  botOwnerId: ALICE,
  botWorkspaceId: WS,
  ...over,
});

function harness() {
  const prisma = {
    user: {
      create: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(botRow()),
    },
    workspaceMember: {
      create: jest.fn().mockResolvedValue({ joinedAt: JOINED }),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ role: 'member' }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    apiKey: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    agentTask: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    botPairingCode: {
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    chatChannel: {
      findUnique: jest.fn().mockResolvedValue({ id: 'general', lastSeq: 4 }),
    },
    chatChannelMember: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([{ channelId: 'general' }]),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    notification: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
    cb(prisma),
  );

  const workspaceService = {
    resolveId: jest.fn((idOrSlug: string) =>
      Promise.resolve(idOrSlug === 'team' ? WS : idOrSlug),
    ),
    assertMember: jest.fn((_wid: string, userId: number) => {
      if (userId === OWNER) return Promise.resolve({ role: 'owner' });
      if (userId === ALICE || userId === BOB) {
        return Promise.resolve({ role: 'member' });
      }
      return Promise.reject(
        new ForbiddenException('Not a member of this workspace'),
      );
    }),
  };
  const apiKeyService = {
    create: jest.fn((_userId: number, _wid: string, name: string) =>
      Promise.resolve({
        id: 'key-1',
        name,
        prefix: 'wfb_abcd',
        key: 'wfb_raw-secret',
      }),
    ),
  };
  const webhookEvents = {
    enabled: false,
    emitMemberEvent: jest.fn().mockResolvedValue(undefined),
  };

  const service = new BotService(
    prisma as never,
    workspaceService as never,
    apiKeyService as never,
    webhookEvents as never,
  );
  return { service, prisma, workspaceService, apiKeyService, webhookEvents };
}

describe('generatePairingCode', () => {
  it('is XXXX-XXXX from the unambiguous alphabet', () => {
    expect(PAIRING_CODE_ALPHABET).toHaveLength(32);
    expect(PAIRING_CODE_ALPHABET).not.toMatch(/[01IO]/);
    for (let i = 0; i < 200; i++) {
      expect(generatePairingCode()).toMatch(
        /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/,
      );
    }
  });

  it('draws every character from the alphabet', () => {
    let n = 0;
    const code = generatePairingCode(() => n++ % 32);
    expect(code).toBe('ABCD-EFGH');
  });
});

describe('BotService', () => {
  describe('create', () => {
    beforeEach(() => jest.clearAllMocks());

    it.each(['', 'a', 'Deck', '-deck', 'deck_bot', 'deck bot', 'a'.repeat(33)])(
      'refuses the name %p',
      async (name) => {
        const { service, prisma } = harness();
        await expect(service.create(WS, ALICE, name)).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(prisma.user.create).not.toHaveBeenCalled();
      },
    );

    it('refuses a non-member', async () => {
      const { service, prisma } = harness();
      await expect(service.create(WS, 99, 'deck-bot')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('creates the bot user and its membership, by slug too', async () => {
      const { service, prisma, webhookEvents } = harness();
      prisma.user.create.mockImplementation(({ data }) =>
        Promise.resolve({
          id: BOT,
          photo: null,
          botLastSeenAt: null,
          botOwner: { id: ALICE, username: 'alice' },
          ...data,
        }),
      );

      const dto = await service.create('team', ALICE, 'deck-bot');

      const { data } = prisma.user.create.mock.calls[0][0];
      expect(data).toEqual({
        kind: 'bot',
        authProvider: 'bot',
        email: expect.stringMatching(
          /^bot-[0-9a-f-]{36}@bots\.wafflebase\.invalid$/,
        ),
        username: 'deck-bot',
        botOwnerId: ALICE,
        botWorkspaceId: WS,
        botInvokers: 'owner',
      });
      expect(prisma.workspaceMember.create).toHaveBeenCalledWith({
        data: { workspaceId: WS, userId: BOT, role: 'member' },
        select: { joinedAt: true },
      });
      // Every member is in #general; a bot is no exception.
      expect(prisma.chatChannelMember.createMany).toHaveBeenCalledWith({
        data: [{ channelId: 'general', userId: BOT, lastReadSeq: 4 }],
        skipDuplicates: true,
      });
      expect(webhookEvents.emitMemberEvent).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          type: 'member.joined',
          workspaceId: WS,
          actor: ALICE,
          userId: BOT,
          role: 'member',
        }),
      );
      // The name check and the insert run under one per-workspace lock.
      expect(prisma.$executeRaw).toHaveBeenCalled();
      expect(dto).toEqual({
        id: BOT,
        username: 'deck-bot',
        photo: null,
        invokers: 'owner',
        owner: { id: ALICE, username: 'alice' },
        createdAt: JOINED.toISOString(),
        lastSeenAt: null,
        hosts: [],
      });
    });

    // A bot named after a person would read as that person in chat, Bot
    // badge or not, so the name is unique among every member here.
    it('answers 409 when any member of the workspace has the name', async () => {
      const { service, prisma } = harness();
      prisma.workspaceMember.findFirst.mockResolvedValue({ userId: 51 });

      await expect(
        service.create(WS, ALICE, 'deck-bot'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.workspaceMember.findFirst).toHaveBeenCalledWith({
        where: {
          workspaceId: WS,
          user: { username: { equals: 'deck-bot', mode: 'insensitive' } },
        },
        select: { userId: true },
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('lists the workspace bots with their live hosts', async () => {
      const { service, prisma } = harness();
      const seen = new Date('2026-11-28T11:00:00.000Z');
      prisma.workspaceMember.findMany.mockResolvedValue([
        {
          joinedAt: JOINED,
          user: {
            id: BOT,
            username: 'deck-bot',
            photo: null,
            botInvokers: 'owner',
            botLastSeenAt: seen,
            botOwner: { id: ALICE, username: 'alice' },
            apiKeys: [{ id: 'key-1', name: 'MacBook', lastUsedAt: seen }],
          },
        },
      ]);

      const bots = await service.list('team', BOB);

      expect(workspaceMemberWhere(prisma)).toEqual({
        workspaceId: WS,
        user: { kind: 'bot' },
      });
      const keyQuery =
        prisma.workspaceMember.findMany.mock.calls[0][0].select.user.select
          .apiKeys;
      expect(keyQuery.where).toEqual({ workspaceId: WS, revokedAt: null });
      expect(bots).toEqual([
        {
          id: BOT,
          username: 'deck-bot',
          photo: null,
          invokers: 'owner',
          owner: { id: ALICE, username: 'alice' },
          createdAt: JOINED.toISOString(),
          lastSeenAt: seen.toISOString(),
          hosts: [
            {
              apiKeyId: 'key-1',
              name: 'MacBook',
              lastUsedAt: seen.toISOString(),
            },
          ],
        },
      ]);
    });

    it('refuses a non-member', async () => {
      const { service } = harness();
      await expect(service.list(WS, 99)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('remove', () => {
    it.each([
      ['its owner', ALICE],
      ['a workspace owner', OWNER],
    ])('lets %s delete it', async (_who, caller) => {
      const { service, prisma, webhookEvents } = harness();

      await service.remove(WS, caller, BOT);

      expect(prisma.apiKey.updateMany).toHaveBeenCalledWith({
        where: { workspaceId: WS, createdBy: BOT, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.workspaceMember.deleteMany).toHaveBeenCalledWith({
        where: { workspaceId: WS, userId: BOT },
      });
      expect(prisma.botPairingCode.deleteMany).toHaveBeenCalledWith({
        where: { botId: BOT, usedAt: null },
      });
      expect(prisma.chatChannelMember.deleteMany).toHaveBeenCalledWith({
        where: { userId: BOT, channelId: { in: ['general'] } },
      });
      // No host can claim them once the keys are revoked; close them out
      // rather than leave them queued forever.
      expect(prisma.agentTask.updateMany).toHaveBeenCalledWith({
        where: { botId: BOT, status: { in: ['queued', 'claimed'] } },
        data: { status: 'failed', finishedAt: expect.any(Date) },
      });
      expect(webhookEvents.emitMemberEvent).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          type: 'member.removed',
          actor: caller,
          userId: BOT,
        }),
      );
      // The user row stays so its messages keep the name.
      expect(prisma.user).not.toHaveProperty('delete');
    });

    it('refuses another ordinary member', async () => {
      const { service, prisma } = harness();
      await expect(service.remove(WS, BOB, BOT)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.apiKey.updateMany).not.toHaveBeenCalled();
      expect(prisma.workspaceMember.deleteMany).not.toHaveBeenCalled();
    });

    it('answers 404 for a user that is not an active bot of the workspace', async () => {
      const { service, prisma } = harness();
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.remove(WS, OWNER, ALICE)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          id: ALICE,
          kind: 'bot',
          botWorkspaceId: WS,
          workspaceMembers: { some: { workspaceId: WS } },
        },
        select: expect.any(Object),
      });
      expect(prisma.apiKey.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('createPairingCode', () => {
    it('stores a ten-minute code for the bot', async () => {
      const { service, prisma } = harness();
      const before = Date.now();

      const result = await service.createPairingCode(WS, ALICE, BOT);

      expect(result.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
      const { data } = prisma.botPairingCode.create.mock.calls[0][0];
      expect(data).toEqual({
        code: result.code,
        botId: BOT,
        createdBy: ALICE,
        expiresAt: expect.any(Date),
      });
      const ttl = data.expiresAt.getTime() - before;
      expect(ttl).toBeGreaterThanOrEqual(PAIRING_CODE_TTL_MS - 1000);
      expect(ttl).toBeLessThanOrEqual(PAIRING_CODE_TTL_MS + 1000);
      expect(PAIRING_CODE_TTL_MS).toBe(10 * 60_000);
      expect(result.expiresAt).toBe(data.expiresAt.toISOString());
    });

    it('retries a code that is already taken', async () => {
      const { service, prisma } = harness();
      prisma.botPairingCode.create
        .mockRejectedValueOnce(
          Object.assign(new Error('Unique constraint failed'), {
            code: 'P2002',
          }),
        )
        .mockResolvedValueOnce({});

      await service.createPairingCode(WS, OWNER, BOT);

      expect(prisma.botPairingCode.create).toHaveBeenCalledTimes(2);
    });

    it('refuses another ordinary member', async () => {
      const { service, prisma } = harness();
      await expect(
        service.createPairingCode(WS, BOB, BOT),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.botPairingCode.create).not.toHaveBeenCalled();
    });
  });

  describe('pair', () => {
    function withCode(
      prisma: ReturnType<typeof harness>['prisma'],
      bot: Record<string, unknown> = botRow(),
    ) {
      prisma.botPairingCode.findUnique.mockResolvedValue({ bot });
    }

    it('spends the code and mints a key that authenticates as the bot', async () => {
      const { service, prisma, apiKeyService } = harness();
      withCode(prisma);

      const result = await service.pair(' 4f2k-9qxd ', '  MacBook Pro  ');

      expect(prisma.botPairingCode.updateMany).toHaveBeenCalledWith({
        where: {
          code: '4F2K-9QXD',
          usedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
        data: { usedAt: expect.any(Date) },
      });
      expect(apiKeyService.create).toHaveBeenCalledWith(
        BOT,
        WS,
        'MacBook Pro',
        ['agent'],
      );
      expect(result).toEqual({
        botId: BOT,
        botName: 'deck-bot',
        workspaceId: WS,
        apiKey: 'wfb_raw-secret',
      });
    });

    it('caps the host name at the key name limit and names a blank one', async () => {
      const { service, prisma, apiKeyService } = harness();
      withCode(prisma);
      await service.pair('4F2K-9QXD', 'h'.repeat(300));
      expect(apiKeyService.create.mock.calls[0][2]).toBe('h'.repeat(100));

      withCode(prisma);
      await service.pair('4F2K-9QXD', '   ');
      expect(apiKeyService.create.mock.calls[1][2]).toBe('Unnamed host');
    });

    // Unknown, expired and used codes all fail the one conditional update,
    // which is also what keeps two exchanges of one code from both winning.
    it('refuses a code the conditional update does not spend', async () => {
      const { service, prisma, apiKeyService } = harness();
      prisma.botPairingCode.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.pair('4F2K-9QXD', 'host')).rejects.toThrow(
        new BadRequestException(
          'Pairing code is invalid, expired, or already used',
        ),
      );
      expect(apiKeyService.create).not.toHaveBeenCalled();
    });

    it('lets only one of two concurrent exchanges win', async () => {
      const { service, prisma, apiKeyService } = harness();
      withCode(prisma);
      prisma.botPairingCode.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      const results = await Promise.allSettled([
        service.pair('4F2K-9QXD', 'a'),
        service.pair('4F2K-9QXD', 'b'),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      expect(apiKeyService.create).toHaveBeenCalledTimes(1);
    });

    it('refuses a malformed code without touching the database', async () => {
      const { service, prisma } = harness();
      await expect(service.pair('not-a-code', 'host')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.botPairingCode.updateMany).not.toHaveBeenCalled();
    });

    it('refuses a code whose bot has since been deleted', async () => {
      const { service, prisma, apiKeyService } = harness();
      withCode(prisma);
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(service.pair('4F2K-9QXD', 'host')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(apiKeyService.create).not.toHaveBeenCalled();
    });
  });
});

function workspaceMemberWhere(prisma: ReturnType<typeof harness>['prisma']) {
  return prisma.workspaceMember.findMany.mock.calls[0][0].where;
}
