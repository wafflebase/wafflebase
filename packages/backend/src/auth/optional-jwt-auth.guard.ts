import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * JWT guard that populates `req.user` when a valid session cookie/token is
 * present but, unlike `JwtAuthGuard`, does not reject anonymous requests.
 * Used by routes that must serve both members (via JWT) and unauthenticated
 * share-link viewers (via a share token checked in the handler).
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(_err: unknown, user: TUser): TUser {
    return (user ?? undefined) as TUser;
  }
}
