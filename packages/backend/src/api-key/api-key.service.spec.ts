import { UnauthorizedException } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { ApiKeyService } from './api-key.service';
import { createHash } from 'crypto';

function createMockPrisma() {
  return {
    apiKey: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
}

describe('ApiKeyService', () => {
  let service: ApiKeyService;
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new ApiKeyService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('create', () => {
    it('generates a key with wfb_ prefix and stores the hash', async () => {
      prisma.apiKey.create.mockImplementation(async ({ data }) => ({
        id: 'key-1',
        name: data.name,
        prefix: data.prefix,
        hashedKey: data.hashedKey,
      }));

      const result = await service.create(1, 'ws-1', 'My Key');

      expect(result.key).toMatch(/^wfb_/);
      expect(result.name).toBe('My Key');
      expect(result.prefix).toBe(result.key.slice(0, 8));
      expect(result.id).toBe('key-1');

      const createArg = prisma.apiKey.create.mock.calls[0][0];
      const expectedHash = createHash('sha256')
        .update(result.key)
        .digest('hex');
      expect(createArg.data.hashedKey).toBe(expectedHash);
      expect(createArg.data.workspaceId).toBe('ws-1');
      expect(createArg.data.createdBy).toBe(1);
      expect(createArg.data.scopes).toEqual(['read', 'write']);
    });

    it('accepts custom scopes and expiresAt', async () => {
      prisma.apiKey.create.mockImplementation(async ({ data }) => ({
        id: 'key-2',
        name: data.name,
        prefix: data.prefix,
      }));

      const expiresAt = new Date('2030-01-01');
      await service.create(1, 'ws-1', 'Custom', ['read'], expiresAt);

      const createArg = prisma.apiKey.create.mock.calls[0][0];
      expect(createArg.data.scopes).toEqual(['read']);
      expect(createArg.data.expiresAt).toBe(expiresAt);
    });
  });

  describe('list', () => {
    it('returns non-revoked keys for the workspace', async () => {
      const keys = [
        { id: 'k1', name: 'Key 1', prefix: 'wfb_abcd' },
        { id: 'k2', name: 'Key 2', prefix: 'wfb_efgh' },
      ];
      prisma.apiKey.findMany.mockResolvedValue(keys);

      const result = await service.list('ws-1');

      expect(result).toEqual(keys);
      expect(prisma.apiKey.findMany).toHaveBeenCalledWith({
        where: { workspaceId: 'ws-1', revokedAt: null },
        select: {
          id: true,
          name: true,
          prefix: true,
          scopes: true,
          createdAt: true,
          expiresAt: true,
          lastUsedAt: true,
        },
      });
    });
  });

  describe('revoke', () => {
    it('sets revokedAt on the key', async () => {
      prisma.apiKey.update.mockResolvedValue({ id: 'k1', revokedAt: new Date() });

      await service.revoke('k1', 'ws-1');

      const updateArg = prisma.apiKey.update.mock.calls[0][0];
      expect(updateArg.where).toEqual({ id: 'k1', workspaceId: 'ws-1' });
      expect(updateArg.data.revokedAt).toBeInstanceOf(Date);
    });
  });

  describe('validateKey', () => {
    const rawKey = 'wfb_test-key-value';
    const hashedKey = createHash('sha256').update(rawKey).digest('hex');

    it('returns the key record for a valid key', async () => {
      const apiKey = {
        id: 'k1',
        hashedKey,
        createdBy: 1,
        workspaceId: 'ws-1',
        scopes: ['read', 'write'],
        revokedAt: null,
        expiresAt: null,
      };
      prisma.apiKey.findUnique.mockResolvedValue(apiKey);
      prisma.apiKey.update.mockResolvedValue({});

      const result = await service.validateKey(rawKey);

      expect(result).toEqual(apiKey);
      expect(prisma.apiKey.findUnique).toHaveBeenCalledWith({
        where: { hashedKey },
      });
    });

    it('throws UnauthorizedException for unknown key', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(null);

      await expect(service.validateKey(rawKey)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException for revoked key', async () => {
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'k1',
        hashedKey,
        revokedAt: new Date(),
        expiresAt: null,
      });

      await expect(service.validateKey(rawKey)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException for expired key', async () => {
      prisma.apiKey.findUnique.mockResolvedValue({
        id: 'k1',
        hashedKey,
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.validateKey(rawKey)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('updates lastUsedAt on successful validation', async () => {
      const apiKey = {
        id: 'k1',
        hashedKey,
        createdBy: 1,
        workspaceId: 'ws-1',
        scopes: ['read'],
        revokedAt: null,
        expiresAt: null,
      };
      prisma.apiKey.findUnique.mockResolvedValue(apiKey);
      prisma.apiKey.update.mockResolvedValue({});

      await service.validateKey(rawKey);

      expect(prisma.apiKey.update).toHaveBeenCalledWith({
        where: { id: 'k1' },
        data: { lastUsedAt: expect.any(Date) },
      });
    });
  });
});
