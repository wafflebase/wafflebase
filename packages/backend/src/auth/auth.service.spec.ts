import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { AuthService } from './auth.service';
import {
  signYorkieServiceToken,
  yorkieServiceTokenInjector,
} from '../yorkie/yorkie-service-token';

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

    // The two halves of the backend's own identity live in different files:
    // `signYorkieServiceToken` mints with a caller-supplied secret,
    // `verifyYorkieToken` verifies with `JWT_SECRET`. Every server-side attach
    // (the v1 content endpoints, document copy, template seeding) depends on
    // them agreeing, and nothing else in the suite joins them — the webhook
    // controller spec stubs the verifier out entirely.
    it('accepts a service token minted by signYorkieServiceToken', () => {
      const service = makeService();
      const payload = service.verifyYorkieToken(
        signYorkieServiceToken('access-secret', '10m'),
      );
      expect(payload).toEqual(
        expect.objectContaining({ typ: 'yorkie-service' }),
      );
      // Carries no subject: there isn't one.
      expect(payload).not.toHaveProperty('sub');
      expect(payload).not.toHaveProperty('shareToken');
    });

    // The same path the real `yorkie.Client` takes: whatever the injector
    // hands Yorkie is what comes back to the webhook.
    it('accepts the token the service injector hands the Yorkie client', async () => {
      const service = makeService();
      const injector = yorkieServiceTokenInjector('access-secret');
      expect(injector).toBeDefined();
      const payload = service.verifyYorkieToken(await injector!());
      expect(payload).toMatchObject({ typ: 'yorkie-service' });
    });

    // A service token from another deployment must not verify here: the whole
    // reason the ops scripts take a per-side secret is that the two sides do
    // not share one.
    it('rejects a service token signed with a foreign secret', () => {
      const service = makeService();
      expect(() =>
        service.verifyYorkieToken(
          signYorkieServiceToken('someone-elses-secret', '10m'),
        ),
      ).toThrow();
    });

    it('rejects an expired service token', () => {
      const service = makeService();
      expect(() =>
        service.verifyYorkieToken(
          signYorkieServiceToken('access-secret', '-1s'),
        ),
      ).toThrow();
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
