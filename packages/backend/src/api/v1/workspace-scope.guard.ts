import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { WorkspaceService } from '../../workspace/workspace.service';

/**
 * Ensures the authenticated user has access to the workspace in the route.
 *
 * For JWT auth: checks workspace membership.
 *
 * For API key auth: the key's `workspaceId` must match the route param **and**
 * the user who minted it must still be a member of that workspace. The scope
 * check alone is a claim frozen at mint time — a key outlives the membership
 * that justified it, so removing somebody from a workspace would otherwise
 * leave every key they ever minted working with full workspace authority. This
 * check is what makes removal revoke them, without a key-revocation sweep on
 * the member-removal path (which would still miss keys minted before it ran).
 */
@Injectable()
export class WorkspaceScopeGuard implements CanActivate {
  constructor(private workspaceService: WorkspaceService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const workspaceId = request.params.workspaceId;

    const resolvedId = await this.workspaceService.resolveId(workspaceId);
    request.params.workspaceId = resolvedId;

    if (user.isApiKey && user.workspaceId !== resolvedId) {
      throw new ForbiddenException('API key is not scoped to this workspace');
    }

    await this.workspaceService.assertMember(resolvedId, Number(user.id));
    return true;
  }
}
