import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GitHubAuthGuard extends AuthGuard('github') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const returnTo = request.query.returnTo;
    if (returnTo) {
      request.session.returnTo = returnTo;
    }

    return (await super.canActivate(context)) as boolean;
  }
}
