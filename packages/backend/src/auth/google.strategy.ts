import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * Whether Google says it has verified this address.
 *
 * It decides whether the sign-in may proceed, because
 * `UserService.findOrCreateUser()` matches on email alone: an unverified
 * address would sign the holder into whatever account already has it,
 * including one created through GitHub. The one `email_verified` claim
 * surfaces in two places — `passport-google-oauth20` copies it onto
 * `emails[].verified` while parsing — and both are read so a profile shape
 * that carries only one is not mistaken for an unverified address. Absence
 * is never taken as verification.
 *
 * GitHub needs no equivalent: on the `user:email` scope it returns only
 * addresses it has verified.
 */
function emailIsVerified(profile: Profile): boolean {
  return (
    profile.emails?.[0]?.verified === true ||
    profile._json?.email_verified === true
  );
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
    const email = profile.emails?.[0]?.value ?? profile._json?.email;

    // Refused rather than signed in without one: the email *is* the account
    // identity here, so a profile without it has nowhere to land.
    if (!email) {
      throw new UnauthorizedException('Google account has no email address');
    }

    if (!emailIsVerified(profile)) {
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
