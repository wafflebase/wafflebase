import { Response } from 'express';
import { Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticatedRequest } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly configService: ConfigService,
  ) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@Req() req: AuthenticatedRequest) {
    return req.user;
  }

  @Post('logout')
  async logout(@Res() res: Response) {
    res.clearCookie('wafflebase_session', {
      httpOnly: true,
      // NOTE(hackerwins): After deploying API to `api.wafflebase.io`, we need to
      // set this to `lax` for security reasons.
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    });

    return res.sendStatus(200);
  }

  @Get('github')
  @UseGuards(AuthGuard('github'))
  async githubAuth() {
    // NOTE(hackerwins): Redirect to GitHub for authentication.
  }

  @Get('github/callback')
  @UseGuards(AuthGuard('github'))
  async githubAuthCallback(
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    const githubUser = req.user;

    const user = await this.userService.findOrCreateUser({
      authProvider: 'github',
      username: githubUser.username,
      email: githubUser.email,
      photo: githubUser.photo,
    });

    if (!user) {
      throw new Error('User not found or created');
    }

    const { token } = await this.authService.createToken(user);

    res.cookie('wafflebase_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 3600000,
    });

    return res.redirect(this.configService.get('FRONTEND_URL')!);
  }
}
