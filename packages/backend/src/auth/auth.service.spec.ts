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

  describe('Yorkie tokens', () => {
    function makeService() {
      const configService = createMockConfig({ JWT_SECRET: 'access-secret' });
      return new AuthService(new JwtService(), configService);
    }

    it('round-trips a user token', () => {
      const service = makeService();
      const payload = service.verifyYorkieToken(
        service.issueYorkieUserToken(42),
      );
      expect(payload).toMatchObject({ typ: 'yorkie', sub: 42 });
    });

    it('round-trips a share token', () => {
      const service = makeService();
      const payload = service.verifyYorkieToken(
        service.issueYorkieShareToken('share-abc'),
      );
      expect(payload).toMatchObject({
        typ: 'yorkie-share',
        shareToken: 'share-abc',
      });
    });

    it('rejects a session access token replayed as a Yorkie token', () => {
      const service = makeService();
      const { accessToken } = service.createTokens(user);
      expect(() => service.verifyYorkieToken(accessToken)).toThrow(
        UnauthorizedException,
      );
    });

    it('throws on a garbage token', () => {
      const service = makeService();
      expect(() => service.verifyYorkieToken('not-a-jwt')).toThrow();
    });

    it('throws on an expired token', () => {
      const configService = createMockConfig({
        JWT_SECRET: 'access-secret',
        YORKIE_TOKEN_EXPIRES_IN: '-1s',
      });
      const service = new AuthService(new JwtService(), configService);
      expect(() => service.verifyYorkieToken(service.issueYorkieUserToken(1))).toThrow();
    });
  });
});
