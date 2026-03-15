import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { UserService } from 'src/user/user.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

function createMockResponse() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    sendStatus: jest.fn(),
    redirect: jest.fn(),
  } as unknown as Response;
}

describe('AuthController', () => {
  const authService = {
    createTokens: jest.fn(),
    verifyRefreshToken: jest.fn(),
  } as unknown as AuthService;

  const userService = {
    user: jest.fn(),
    findOrCreateUser: jest.fn(),
  } as unknown as UserService;

  const configService = {
    get: jest.fn((key: string) => {
      if (key === 'FRONTEND_URL') return 'http://localhost:5173';
      if (key === 'JWT_ACCESS_COOKIE_MAX_AGE_MS') return '1000';
      if (key === 'JWT_REFRESH_COOKIE_MAX_AGE_MS') return '2000';
      return undefined;
    }),
  } as unknown as ConfigService;

  const controller = new AuthController(authService, userService, configService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('clears both cookies on logout', async () => {
    const res = createMockResponse();
    (res.sendStatus as jest.Mock).mockReturnValue(undefined);

    await controller.logout(res);

    expect(res.clearCookie).toHaveBeenCalledWith(
      'wafflebase_session',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      'wafflebase_refresh',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  it('refreshes cookies when refresh token is valid', async () => {
    const req = {
      cookies: {
        wafflebase_refresh: 'refresh-token',
      },
    } as unknown as Request;
    const res = createMockResponse();
    (res.sendStatus as jest.Mock).mockReturnValue(undefined);
    (authService.verifyRefreshToken as jest.Mock).mockReturnValue({ sub: 7 });
    (userService.user as jest.Mock).mockResolvedValue({
      id: 7,
      authProvider: 'github',
      username: 'alice',
      email: 'alice@example.com',
      photo: null,
    });
    (authService.createTokens as jest.Mock).mockReturnValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token-next',
    });

    await controller.refresh(req, res);

    expect(authService.verifyRefreshToken).toHaveBeenCalledWith('refresh-token');
    expect(userService.user).toHaveBeenCalledWith({ id: 7 });
    expect(res.cookie).toHaveBeenCalledWith(
      'wafflebase_session',
      'access-token',
      expect.objectContaining({ maxAge: 1000 }),
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'wafflebase_refresh',
      'refresh-token-next',
      expect.objectContaining({ maxAge: 2000 }),
    );
    expect(res.sendStatus).toHaveBeenCalledWith(200);
  });

  it('rejects refresh requests without refresh cookie', async () => {
    const req = {
      cookies: {},
    } as unknown as Request;
    const res = createMockResponse();

    await expect(controller.refresh(req, res)).rejects.toThrow(
      UnauthorizedException,
    );

    expect(res.clearCookie).toHaveBeenCalledWith(
      'wafflebase_session',
      expect.any(Object),
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      'wafflebase_refresh',
      expect.any(Object),
    );
  });
});

describe('JwtStrategy', () => {
  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_SECRET') return 'test-secret';
      return undefined;
    }),
  } as unknown as ConfigService;

  it('extracts JWT from wafflebase_session cookie', () => {
    const strategy = new JwtStrategy(mockConfigService);
    const req = {
      cookies: { wafflebase_session: 'cookie-token' },
      headers: {},
    } as unknown as Request;

    // Access the internal _jwtFromRequest extractor
    const extractor = (strategy as any)._jwtFromRequest;
    const token = extractor(req);

    expect(token).toBe('cookie-token');
  });

  it('extracts JWT from Authorization Bearer header', () => {
    const strategy = new JwtStrategy(mockConfigService);
    const req = {
      cookies: {},
      headers: { authorization: 'Bearer bearer-token' },
    } as unknown as Request;

    const extractor = (strategy as any)._jwtFromRequest;
    const token = extractor(req);

    expect(token).toBe('bearer-token');
  });

  it('prefers cookie over Authorization Bearer header when both present', () => {
    const strategy = new JwtStrategy(mockConfigService);
    const req = {
      cookies: { wafflebase_session: 'cookie-token' },
      headers: { authorization: 'Bearer bearer-token' },
    } as unknown as Request;

    const extractor = (strategy as any)._jwtFromRequest;
    const token = extractor(req);

    expect(token).toBe('cookie-token');
  });
});
