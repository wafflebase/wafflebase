import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { ApiKeyAuthGuard } from './api-key-auth.guard';

/**
 * Like {@link CombinedAuthGuard}, but the JWT branch is *optional*: an
 * anonymous request (no session cookie, no API key) passes the guard with
 * `req.user` left undefined instead of being rejected. Used by routes that
 * must serve workspace members (JWT), API-key integrations, AND anonymous
 * share-link viewers whose authority is a `?token=` checked in the handler.
 *
 * A `Bearer wfb_...` header still routes to the API-key guard, which DOES
 * reject an invalid key — an anonymous caller simply sends no such header.
 */
@Injectable()
export class OptionalCombinedAuthGuard implements CanActivate {
  constructor(
    private optionalJwtGuard: OptionalJwtAuthGuard,
    private apiKeyGuard: ApiKeyAuthGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers?.authorization;

    const [scheme, token] = authHeader?.trim().split(/\s+/, 2) ?? [];
    if (scheme?.toLowerCase() === 'bearer' && token?.startsWith('wfb_')) {
      return this.apiKeyGuard.canActivate(context) as Promise<boolean>;
    }

    return this.optionalJwtGuard.canActivate(context) as Promise<boolean>;
  }
}
