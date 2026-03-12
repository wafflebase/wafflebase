import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { WorkspaceService } from '../../workspace/workspace.service';

/**
 * Ensures the authenticated user has access to the workspace in the route.
 * For API key auth: verifies the key's workspaceId matches the route param.
 * For JWT auth: checks workspace membership.
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

    if (user.isApiKey) {
      if (user.workspaceId !== resolvedId) {
        throw new ForbiddenException(
          'API key is not scoped to this workspace',
        );
      }
      return true;
    }

    await this.workspaceService.assertMember(resolvedId, Number(user.id));
    return true;
  }
}
