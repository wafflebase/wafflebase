import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-github2';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GitHubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(configService: ConfigService) {
    super({
      clientID: configService.get('GITHUB_CLIENT_ID')!,
      clientSecret: configService.get('GITHUB_CLIENT_SECRET')!,
      callbackURL: configService.get('GITHUB_CALLBACK_URL')!,
      scope: ['user:email'],
    });
  }

  async validate(accessToken: string, refreshToken: string, profile: Profile) {
    const { id, username, emails } = profile;

    return {
      githubId: id,
      username,
      email: emails && emails[0].value,
      accessToken,
    };
  }
}
