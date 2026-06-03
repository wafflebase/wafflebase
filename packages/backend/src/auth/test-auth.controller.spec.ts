import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { TestAuthController } from './test-auth.controller';

describe('TestAuthController', () => {
  let controller: TestAuthController;
  let userService: { findOrCreateUser: jest.Mock };
  let res: Pick<Response, 'cookie' | 'json' | 'status'> & { cookie: jest.Mock; json: jest.Mock };

  beforeEach(async () => {
    userService = { findOrCreateUser: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [TestAuthController],
      providers: [
        AuthService,
        JwtService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              ({
                JWT_SECRET: 'test-secret',
                JWT_ACCESS_EXPIRES_IN: '1h',
                JWT_REFRESH_EXPIRES_IN: '7d',
                NODE_ENV: 'test',
              })[key],
          },
        },
        { provide: UserService, useValue: userService },
      ],
    }).compile();

    controller = moduleRef.get(TestAuthController);
    res = {
      cookie: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis() as never,
    };
  });

  it('creates or fetches the test user and sets both auth cookies', async () => {
    userService.findOrCreateUser.mockResolvedValue({
      id: 42,
      username: 'e2e-0',
      email: 'e2e-0@test.local',
      photo: null,
      authProvider: 'test',
    });

    await controller.login(
      { username: 'e2e-0', email: 'e2e-0@test.local' },
      res as unknown as Response,
    );

    expect(userService.findOrCreateUser).toHaveBeenCalledWith({
      authProvider: 'test',
      username: 'e2e-0',
      email: 'e2e-0@test.local',
      photo: null,
    });
    // Exact match (not objectContaining) so a future regression that adds
    // an unintended attribute — e.g. `domain: 'evil.com'`, `secure: true`
    // out of band, `sameSite: 'none'` — fails the test loudly.
    expect(res.cookie).toHaveBeenCalledWith(
      'wafflebase_session',
      expect.any(String),
      { httpOnly: true, sameSite: 'lax', secure: false },
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'wafflebase_refresh',
      expect.any(String),
      { httpOnly: true, sameSite: 'lax', secure: false },
    );
    expect(res.json).toHaveBeenCalledWith({ ok: true, userId: 42 });
  });
});
