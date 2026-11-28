import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { assertAgentKeyScope } from './agent-key-scope';

@Injectable()
export class ApiKeyAuthGuard extends AuthGuard('api-key') {
  constructor() {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ok = (await super.canActivate(context)) as boolean;
    // Every route that accepts a key comes through here, so this is the one
    // place a bot key is kept to the agent routes.
    assertAgentKeyScope(
      context.switchToHttp().getRequest().user,
      context.getClass(),
    );
    return ok;
  }
}
