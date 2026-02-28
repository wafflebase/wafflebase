import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import type ms from 'ms';

type AuthPayloadBase = {
  sub: number;
  username: string;
  email: string;
  photo: string | null;
};

type AccessTokenPayload = AuthPayloadBase & {
  tokenType: 'access';
};

type RefreshTokenPayload = AuthPayloadBase & {
  tokenType: 'refresh';
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

@Injectable()
export class AuthService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessExpiresIn: ms.StringValue;
  private readonly refreshExpiresIn: ms.StringValue;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.accessSecret = this.requireConfig('JWT_SECRET');
    this.refreshSecret =
      this.configService.get<string>('JWT_REFRESH_SECRET') ?? this.accessSecret;
    this.accessExpiresIn =
      (this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '1h') as ms.StringValue;
    this.refreshExpiresIn =
      (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d') as ms.StringValue;
  }

  createTokens(user: User): AuthTokens {
    const payload: AuthPayloadBase = {
      sub: user.id,
      username: user.username,
      email: user.email,
      photo: user.photo,
    };

    return {
      accessToken: this.jwtService.sign(
        { ...payload, tokenType: 'access' } satisfies AccessTokenPayload,
        {
          secret: this.accessSecret,
          expiresIn: this.accessExpiresIn,
        },
      ),
      refreshToken: this.jwtService.sign(
        { ...payload, tokenType: 'refresh' } satisfies RefreshTokenPayload,
        {
          secret: this.refreshSecret,
          expiresIn: this.refreshExpiresIn,
        },
      ),
    };
  }

  verifyRefreshToken(refreshToken: string): RefreshTokenPayload {
    const payload = this.jwtService.verify<RefreshTokenPayload>(refreshToken, {
      secret: this.refreshSecret,
    });

    if (payload.tokenType !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return payload;
  }

  private requireConfig(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new Error(`${key} is required`);
    }

    return value;
  }
}
