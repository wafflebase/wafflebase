import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { AuthService } from './auth.service';

function createMockConfig(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('AuthService', () => {
  const user: User = {
    id: 1,
    authProvider: 'github',
    username: 'alice',
    email: 'alice@example.com',
    photo: null,
  };

  it('creates access and refresh tokens with different token types', () => {
    const configService = createMockConfig({
      JWT_SECRET: 'access-secret',
      JWT_REFRESH_SECRET: 'refresh-secret',
      JWT_ACCESS_EXPIRES_IN: '1h',
      JWT_REFRESH_EXPIRES_IN: '7d',
    });
    const jwtService = new JwtService();
    const service = new AuthService(jwtService, configService);

    const tokens = service.createTokens(user);
    const accessPayload = jwtService.verify(tokens.accessToken, {
      secret: 'access-secret',
    }) as { tokenType: string; sub: number };
    const refreshPayload = service.verifyRefreshToken(tokens.refreshToken);

    expect(accessPayload.tokenType).toBe('access');
    expect(accessPayload.sub).toBe(user.id);
    expect(refreshPayload.tokenType).toBe('refresh');
    expect(refreshPayload.sub).toBe(user.id);
  });

  it('rejects non-refresh tokens in verifyRefreshToken', () => {
    const configService = createMockConfig({
      JWT_SECRET: 'shared-secret',
      JWT_REFRESH_SECRET: 'shared-secret',
    });
    const jwtService = new JwtService();
    const service = new AuthService(jwtService, configService);

    const { accessToken } = service.createTokens(user);

    expect(() => service.verifyRefreshToken(accessToken)).toThrow(
      UnauthorizedException,
    );
  });
});
