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

/**
 * Short-lived token handed to the Yorkie client's `authTokenInjector`, echoed
 * back to us verbatim in the auth-webhook request body. It carries only the
 * caller's identity — the webhook resolves document access from it. Two shapes:
 * an authenticated user (`sub`), or an anonymous share-link visitor whose rights
 * come from the link (`shareToken`). Never the raw session JWT — that is
 * httpOnly and must not reach client JS.
 */
export type YorkieTokenPayload =
  | { typ: 'yorkie'; sub: number }
  | { typ: 'yorkie-share'; shareToken: string };

@Injectable()
export class AuthService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessExpiresIn: ms.StringValue;
  private readonly refreshExpiresIn: ms.StringValue;
  private readonly yorkieTokenExpiresIn: ms.StringValue;

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
    // Short by design: the webhook re-checks Postgres on every use, so a stale
    // token only widens the window before a revoked role stops working. On
    // expiry Yorkie 401s and the client silently re-fetches via authTokenInjector.
    this.yorkieTokenExpiresIn =
      (this.configService.get<string>('YORKIE_TOKEN_EXPIRES_IN') ??
        '10m') as ms.StringValue;
  }

  /** Mint a Yorkie auth-webhook token for an authenticated user. */
  issueYorkieUserToken(userId: number): string {
    return this.jwtService.sign(
      { typ: 'yorkie', sub: userId } satisfies YorkieTokenPayload,
      { secret: this.accessSecret, expiresIn: this.yorkieTokenExpiresIn },
    );
  }

  /** Mint a Yorkie auth-webhook token for an anonymous share-link visitor. */
  issueYorkieShareToken(shareToken: string): string {
    return this.jwtService.sign(
      { typ: 'yorkie-share', shareToken } satisfies YorkieTokenPayload,
      { secret: this.accessSecret, expiresIn: this.yorkieTokenExpiresIn },
    );
  }

  /**
   * Verify a Yorkie auth-webhook token. Throws (JsonWebTokenError /
   * TokenExpiredError) on any invalid/expired/foreign token, which the webhook
   * maps to a 401 so the client refreshes. Rejects other token types (access/
   * refresh) so a leaked session JWT can't be replayed here.
   */
  verifyYorkieToken(token: string): YorkieTokenPayload {
    const payload = this.jwtService.verify<YorkieTokenPayload & object>(token, {
      secret: this.accessSecret,
    });
    if (payload.typ !== 'yorkie' && payload.typ !== 'yorkie-share') {
      throw new UnauthorizedException('Invalid Yorkie token type');
    }
    return payload;
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
