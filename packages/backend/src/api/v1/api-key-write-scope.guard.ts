import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../../auth/auth.types';

/** HTTP methods that mutate state and therefore need the `write` scope. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Enforce the API key's `write` scope on every mutating v1 route.
 *
 * `ApiKey.scopes` is a real capability — an owner can mint a key with
 * `scopes: ['read']` (`CreateApiKeyDto`) and `ApiKeyStrategy.validate` puts it
 * on `req.user.scopes` — but neither guard in front of the v1 controllers
 * reads it: `CombinedAuthGuard` only proves the key is valid and
 * `WorkspaceScopeGuard` only that it is bound to the workspace in the route.
 *
 * That check used to be hand-written inside two handlers (`documents.remove`,
 * `files.upload`), which left the other seven mutating v1 routes ungated —
 * most damagingly `PUT /content`, where `writeSlidesRoot` / `writeDocsRoot` /
 * `writeNoteRoot` are a *destructive replace* of a document's whole content.
 * A read-only credential could therefore overwrite every doc, deck and note in
 * the workspace. Two handlers carrying the check also made the surface read as
 * covered, which is why this is a guard keyed on the HTTP method rather than a
 * third copy of the same `if`: a new mutating route is gated the moment it is
 * added to a controller that mounts this guard, without anyone remembering to
 * write the check.
 *
 * JWT callers are untouched. Their authority is workspace membership and
 * document ownership, which the per-handler checks (and `WorkspaceScopeGuard`)
 * already resolve; scopes exist only on API keys.
 */
@Injectable()
export class ApiKeyWriteScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Partial<AuthenticatedRequest>>();
    if (!MUTATING_METHODS.has(request.method ?? '')) return true;
    const user = request.user;
    if (!user?.isApiKey) return true;
    if (!user.scopes?.includes('write')) {
      throw new ForbiddenException('This API key does not have write access');
    }
    return true;
  }
}
