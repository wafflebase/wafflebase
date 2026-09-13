import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { createHash, randomBytes } from 'crypto';

/**
 * Narrows a listing or a revocation to one creator's own keys.
 *
 * A key authenticates as the user who minted it (`ApiKeyStrategy` puts
 * `createdBy` in the request identity), so "your keys" is a real boundary and
 * not a cosmetic one: another member's key is another member's authority.
 * Callers pass `{ createdBy }` for an ordinary member and `{}` for a workspace
 * owner, who administers every key in the workspace.
 */
type KeyScope = { createdBy?: number };

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

  async list(workspaceId: string, scope: KeyScope = {}) {
    return this.prisma.apiKey.findMany({
      where: {
        workspaceId,
        revokedAt: null,
        ...(scope.createdBy === undefined
          ? {}
          : { createdBy: scope.createdBy }),
      },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        createdBy: true,
        createdAt: true,
        expiresAt: true,
        lastUsedAt: true,
      },
    });
  }

  /**
   * Revokes a key, refusing one the caller does not own when `scope` names a
   * creator.
   *
   * A key outside the scope answers 404 rather than 403: whether this
   * workspace holds another member's integration is itself information, and
   * the miss and the refusal are indistinguishable to the caller either way.
   *
   * `updateMany` rather than `update` because narrowing by `createdBy` does
   * not fit `update`'s unique-only `where`; the row count is then the whole
   * ownership answer. The revoked row is read back and returned because
   * callers report it — `wafflebase api-keys revoke` prints it, and the CLI
   * schema declares an `id` — but through an explicit selection, since
   * `update`'s default return handed back `hashedKey` as well.
   */
  async revoke(id: string, workspaceId: string, scope: KeyScope = {}) {
    const result = await this.prisma.apiKey.updateMany({
      where: {
        id,
        workspaceId,
        ...(scope.createdBy === undefined
          ? {}
          : { createdBy: scope.createdBy }),
      },
      data: { revokedAt: new Date() },
    });

    if (result.count === 0) {
      throw new NotFoundException('API key not found');
    }

    return this.prisma.apiKey.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        createdBy: true,
        revokedAt: true,
      },
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
