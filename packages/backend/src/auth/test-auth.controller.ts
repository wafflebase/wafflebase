import {
  Body,
  Controller,
  HttpCode,
  Post,
  Res,
} from '@nestjs/common';
import { Response, CookieOptions } from 'express';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';

const ACCESS_COOKIE_NAME = 'wafflebase_session';
const REFRESH_COOKIE_NAME = 'wafflebase_refresh';

type LoginBody = { username: string; email: string };

@Controller('test/auth')
export class TestAuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: LoginBody, @Res() res: Response) {
    const user = await this.userService.findOrCreateUser({
      authProvider: 'test',
      username: body.username,
      email: body.email,
      photo: null,
    });

    if (!user) {
      throw new Error('Failed to create test user');
    }

    const tokens = this.authService.createTokens(user);
    const baseCookieOptions: CookieOptions = {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
    };

    res.cookie(ACCESS_COOKIE_NAME, tokens.accessToken, baseCookieOptions);
    res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, baseCookieOptions);
    res.json({ ok: true, userId: user.id });
  }
}
