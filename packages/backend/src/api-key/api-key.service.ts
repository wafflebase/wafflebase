import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { createHash, randomBytes } from 'crypto';

@Injectable()
export class ApiKeyService {
  constructor(private prisma: PrismaService) {}

  async create(
    userId: number,
    workspaceId: string,
    name: string,
    scopes?: string[],
    expiresAt?: Date,
  ) {
    const rawKey = 'wfb_' + randomBytes(32).toString('base64url');
    const hashedKey = createHash('sha256').update(rawKey).digest('hex');
    const prefix = rawKey.slice(0, 8);

    const apiKey = await this.prisma.apiKey.create({
      data: {
        name,
        prefix,
        hashedKey,
        workspaceId,
        createdBy: userId,
        scopes: scopes ?? ['read', 'write'],
        expiresAt: expiresAt ?? null,
      },
    });

    return {
      id: apiKey.id,
      name: apiKey.name,
      prefix: apiKey.prefix,
      key: rawKey,
    };
  }

  async list(workspaceId: string) {
    return this.prisma.apiKey.findMany({
      where: {
        workspaceId,
        revokedAt: null,
      },
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
  }

  async revoke(id: string, workspaceId: string) {
    return this.prisma.apiKey.update({
      where: { id, workspaceId },
      data: { revokedAt: new Date() },
    });
  }

  async validateKey(rawKey: string) {
    const hashedKey = createHash('sha256').update(rawKey).digest('hex');

    const apiKey = await this.prisma.apiKey.findUnique({
      where: { hashedKey },
    });

    if (!apiKey) {
      throw new UnauthorizedException('Invalid API key');
    }

    if (apiKey.revokedAt) {
      throw new UnauthorizedException('API key has been revoked');
    }

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      throw new UnauthorizedException('API key has expired');
    }

    // Update lastUsedAt fire-and-forget
    this.prisma.apiKey
      .update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {});

    return apiKey;
  }
}
