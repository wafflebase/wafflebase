import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

function makeStrategy() {
  const config = {
    get: jest.fn((k: string) => (k === 'JWT_SECRET' ? 'secret' : undefined)),
  } as unknown as ConfigService;
  return new JwtStrategy(config);
}

describe('JwtStrategy.validate', () => {
  const base = {
    sub: 1,
    username: 'alice',
    email: 'alice@example.com',
    photo: null,
  };

  it('accepts an access token', async () => {
    const user = await makeStrategy().validate({
      ...base,
      tokenType: 'access',
    });
    expect(user).toEqual({
      id: 1,
      username: 'alice',
      email: 'alice@example.com',
      photo: null,
    });
  });

  it('rejects a refresh token replayed as a Bearer session', async () => {
    await expect(
      makeStrategy().validate({ ...base, tokenType: 'refresh' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a client-readable Yorkie token replayed as a session', async () => {
    await expect(
      makeStrategy().validate({ typ: 'yorkie', sub: 1 }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token with no token type', async () => {
    await expect(makeStrategy().validate(base)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
