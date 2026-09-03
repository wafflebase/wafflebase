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
 * leave every key they ever minted working with full workspace authority.
 * `WorkspaceService.removeMember` revokes those rows outright; this check is
 * the live half, covering every other way a membership ends (a workspace
 * deleted and re-created, a row removed out of band) and refusing the key the
 * moment the membership is gone rather than at its next validation.
 *
 * Every v1 controller mounts this guard. The one route that cannot —
 * `ApiV1ImageReadController`, which also serves anonymous share-token viewers
 * — repeats the same two checks by hand.
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
