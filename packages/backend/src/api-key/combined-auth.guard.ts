import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiKeyAuthGuard } from './api-key-auth.guard';

@Injectable()
export class CombinedAuthGuard implements CanActivate {
  constructor(
    private jwtGuard: JwtAuthGuard,
    private apiKeyGuard: ApiKeyAuthGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers?.authorization;

    const [scheme, token] = authHeader?.trim().split(/\s+/, 2) ?? [];
    if (scheme?.toLowerCase() === 'bearer' && token?.startsWith('wfb_')) {
      return this.apiKeyGuard.canActivate(context) as Promise<boolean>;
    }

    return this.jwtGuard.canActivate(context) as Promise<boolean>;
  }
}
