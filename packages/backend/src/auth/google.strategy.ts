import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * A verification flag, whichever of the shapes Google has shipped it in.
 *
 * `=== true` alone was wrong: OpenID Connect says `email_verified` is a
 * boolean, but Google's userinfo endpoint has historically returned it (and
 * `verified_email`) as the **string** `"true"`, and
 * `passport-google-oauth20` copies the raw JSON value onto
 * `emails[].verified` without coercing it. Against such a response a strict
 * comparison reads a verified address as unverified and refuses every Google
 * login on the deployment. Anything that is not one of the two affirmative
 * spellings — absent, `false`, `"false"`, a number — is still not
 * verification.
 */
function isVerifiedFlag(value: unknown): boolean {
  return value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');
}

/** The raw ID-token/userinfo claims, which the typings stop short of. */
interface GoogleClaims {
  email?: string;
  email_verified?: unknown;
  verified_email?: unknown;
}

/**
 * The address to sign in with, and whether Google says *that* address is
 * verified.
 *
 * The two travel together on purpose. Verification decides whether the
 * sign-in may proceed at all, because `UserService.findOrCreateUser()`
 * matches on email alone: an unverified address would sign its holder into
 * whatever account already has it, including one created through GitHub. So
 * a flag is only allowed to vouch for the address it actually belongs to —
 * reading `emails[0].verified || _json.email_verified` as a flat OR let a
 * verified `_json.email` vouch for a *different*, unverified `emails[0]`,
 * which is the address that would then be used.
 *
 * Both sources are still consulted, because the one claim surfaces in two
 * places (`passport-google-oauth20` copies it onto `emails[].verified` while
 * parsing) and a profile shape carrying only one must not read as
 * unverified. Absence is never taken as verification.
 */
function resolveEmail(profile: Profile): {
  email?: string;
  verified: boolean;
} {
  const claims = profile._json as GoogleClaims | undefined;
  const entry = profile.emails?.[0];
  const email = entry?.value ?? claims?.email;
  if (!email) return { verified: false };

  const flags: unknown[] = [];
  if (entry?.value === email) flags.push(entry.verified);
  if (claims?.email === email) {
    flags.push(claims.email_verified, claims.verified_email);
  }
  return { email, verified: flags.some(isVerifiedFlag) };
}

/**
 * The name a Google account is displayed and slugged under.
 *
 * Google has no username. `displayName` is what a person recognises, but it
 * is not guaranteed to be present, so the email's local part is the
 * fallback — it is always there by the time this runs, since a profile with
 * no email is refused above.
 */
function usernameFor(profile: Profile, email: string): string {
  return profile.displayName?.trim() || email.split('@')[0];
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(configService: ConfigService) {
    super({
      clientID: configService.get('GOOGLE_CLIENT_ID')!,
      clientSecret: configService.get('GOOGLE_CLIENT_SECRET')!,
      // Required, unlike GitHub's: Google's authorization endpoint has no
      // fallback to the URL registered on the OAuth client and answers
      // `redirect_uri_mismatch` without one. `googleAuthConfigured()` is
      // what keeps this from being reached unset.
      callbackURL: configService.get('GOOGLE_CALLBACK_URL')!,
      scope: ['profile', 'email'],
    });
  }

  /**
   * Forward the `state` the guard attached — the same contract
   * `GitHubStrategy.authenticate` has. A login that reached Google
   * stateless is a login the callback would refuse, so it could never come
   * back. Anything without the flag is not a login start (no guard ran) and
   * is left to passport's own handling.
   */
  authenticate(req: Request, options?: Record<string, unknown>) {
    const opts = { ...options };
    const state = (req as { __oauthState?: string }).__oauthState;
    if (state) {
      opts.state = state;
    }
    super.authenticate(req, opts);
  }

  validate(accessToken: string, _refreshToken: string, profile: Profile) {
    const { email, verified } = resolveEmail(profile);

    // Refused rather than signed in without one: the email *is* the account
    // identity here, so a profile without it has nowhere to land.
    if (!email) {
      throw new UnauthorizedException('Google account has no email address');
    }

    if (!verified) {
      throw new UnauthorizedException(
        'Google account email is not verified. Verify it with Google and ' +
          'try again.',
      );
    }

    return {
      authProvider: 'google',
      googleId: profile.id,
      username: usernameFor(profile, email),
      email,
      photo: profile.photos?.[0]?.value ?? profile._json?.picture,
      accessToken,
    };
  }
}
