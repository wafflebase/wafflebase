import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => {
          return request?.cookies?.wafflebase_session;
        },
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET')!,
    });
  }

  async validate(payload: any) {
    // Only an access token grants an API session. Other JWTs signed with the
    // same secret — the refresh token (`tokenType: 'refresh'`, which shares
    // JWT_SECRET when JWT_REFRESH_SECRET is unset) and the client-readable
    // Yorkie auth-webhook token (`typ: 'yorkie'`) — must not be replayable as a
    // Bearer session. The Yorkie token in particular is exposed to client JS
    // (unlike the httpOnly session cookie), so accepting it here would be a
    // privilege escalation.
    if (payload?.tokenType !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }
    return {
      id: payload.sub,
      username: payload.username,
      email: payload.email,
      photo: payload.photo,
    };
  }
}
