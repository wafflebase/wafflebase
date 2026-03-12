import { ExecutionContext } from '@nestjs/common';
import { CombinedAuthGuard } from './combined-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiKeyAuthGuard } from './api-key-auth.guard';

function createMockContext(authHeader?: string): ExecutionContext {
  const request = {
    headers: authHeader ? { authorization: authHeader } : {},
  };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('CombinedAuthGuard', () => {
  let guard: CombinedAuthGuard;
  let jwtGuard: JwtAuthGuard;
  let apiKeyGuard: ApiKeyAuthGuard;

  beforeEach(() => {
    jwtGuard = { canActivate: jest.fn().mockResolvedValue(true) } as any;
    apiKeyGuard = { canActivate: jest.fn().mockResolvedValue(true) } as any;
    guard = new CombinedAuthGuard(jwtGuard, apiKeyGuard);
  });

  it('delegates to ApiKeyAuthGuard when header starts with Bearer wfb_', async () => {
    const ctx = createMockContext('Bearer wfb_abc123');

    await guard.canActivate(ctx);

    expect(apiKeyGuard.canActivate).toHaveBeenCalledWith(ctx);
    expect(jwtGuard.canActivate).not.toHaveBeenCalled();
  });

  it('delegates to ApiKeyAuthGuard with lowercase bearer scheme', async () => {
    const ctx = createMockContext('bearer wfb_abc123');

    await guard.canActivate(ctx);

    expect(apiKeyGuard.canActivate).toHaveBeenCalledWith(ctx);
    expect(jwtGuard.canActivate).not.toHaveBeenCalled();
  });

  it('delegates to ApiKeyAuthGuard with extra whitespace', async () => {
    const ctx = createMockContext('Bearer   wfb_abc123');

    await guard.canActivate(ctx);

    expect(apiKeyGuard.canActivate).toHaveBeenCalledWith(ctx);
    expect(jwtGuard.canActivate).not.toHaveBeenCalled();
  });

  it('delegates to JwtAuthGuard when header does not start with Bearer wfb_', async () => {
    const ctx = createMockContext('Bearer eyJhbG...');

    await guard.canActivate(ctx);

    expect(jwtGuard.canActivate).toHaveBeenCalledWith(ctx);
    expect(apiKeyGuard.canActivate).not.toHaveBeenCalled();
  });

  it('delegates to JwtAuthGuard when no Authorization header', async () => {
    const ctx = createMockContext();

    await guard.canActivate(ctx);

    expect(jwtGuard.canActivate).toHaveBeenCalledWith(ctx);
    expect(apiKeyGuard.canActivate).not.toHaveBeenCalled();
  });
});
