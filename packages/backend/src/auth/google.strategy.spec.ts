import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Profile } from 'passport-google-oauth20';
import { GoogleStrategy } from './google.strategy';

const CONFIG = {
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_CALLBACK_URL: 'http://localhost:3000/auth/google/callback',
};

function makeStrategy(): GoogleStrategy {
  return new GoogleStrategy({
    get: (k: string) => (CONFIG as Record<string, string>)[k],
  } as unknown as ConfigService);
}

/** A profile in the shape `passport-google-oauth20` hands to `validate`. */
function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    provider: 'google',
    id: '10769150350006150715113082367',
    displayName: 'Ada Lovelace',
    emails: [{ value: 'ada@example.com', verified: true }],
    photos: [{ value: 'https://lh3.example.com/ada.jpg' }],
    profileUrl: '',
    _raw: '',
    _json: {
      iss: 'https://accounts.google.com',
      aud: 'id',
      sub: '10769150350006150715113082367',
      iat: 0,
      exp: 0,
      email: 'ada@example.com',
      email_verified: true,
    },
    ...overrides,
  } as Profile;
}

describe('GoogleStrategy', () => {
  it('maps a verified profile onto the fields findOrCreateUser wants', () => {
    const user = makeStrategy().validate('token', '', makeProfile());

    expect(user).toEqual({
      authProvider: 'google',
      googleId: '10769150350006150715113082367',
      username: 'Ada Lovelace',
      email: 'ada@example.com',
      photo: 'https://lh3.example.com/ada.jpg',
      accessToken: 'token',
    });
  });

  // `findOrCreateUser` matches on email alone, so an unverified address
  // would sign its holder into whatever account already has it — including
  // one created through GitHub. This refusal is what makes the merge safe.
  it.each([
    [
      'both signals false',
      {
        emails: [{ value: 'ada@example.com', verified: false }],
        _json: { ...makeProfile()._json, email_verified: false },
      },
    ],
    [
      'neither signal present',
      {
        emails: [{ value: 'ada@example.com' }],
        _json: { ...makeProfile()._json, email_verified: undefined },
      },
    ],
  ])('refuses an unverified email (%s)', (_name, overrides) => {
    expect(() =>
      makeStrategy().validate(
        'token',
        '',
        makeProfile(overrides as unknown as Partial<Profile>),
      ),
    ).toThrow(UnauthorizedException);
  });

  // Either signal on its own is Google saying it verified the address; a
  // profile shape that only carries one must not be read as unverified.
  it('accepts the raw email_verified claim when emails[] has no flag', () => {
    const user = makeStrategy().validate(
      'token',
      '',
      makeProfile({
        emails: [{ value: 'ada@example.com' }] as Profile['emails'],
      }),
    );
    expect(user.email).toBe('ada@example.com');
  });

  // Google's userinfo has shipped `email_verified` / `verified_email` as the
  // string `"true"`, and passport copies the raw JSON value through without
  // coercing it. A strict `=== true` refused every login on such a response.
  it.each([
    [
      'emails[].verified',
      { emails: [{ value: 'ada@example.com', verified: 'true' }] },
    ],
    [
      'the raw email_verified claim',
      {
        emails: [{ value: 'ada@example.com' }],
        _json: { ...makeProfile()._json, email_verified: 'true' },
      },
    ],
    [
      'the verified_email spelling',
      {
        emails: [{ value: 'ada@example.com' }],
        _json: {
          ...makeProfile()._json,
          email_verified: undefined,
          verified_email: true,
        },
      },
    ],
  ])('accepts %s as verification', (_name, overrides) => {
    const user = makeStrategy().validate(
      'token',
      '',
      makeProfile(overrides as unknown as Partial<Profile>),
    );
    expect(user.email).toBe('ada@example.com');
  });

  // The flag has to vouch for the address actually used. Read as a flat OR,
  // a verified `_json.email` signed the holder in under a DIFFERENT,
  // unverified `emails[0]` — which is the address `findOrCreateUser` then
  // matches on.
  it('refuses when the verified flag belongs to another address', () => {
    expect(() =>
      makeStrategy().validate(
        'token',
        '',
        makeProfile({
          emails: [{ value: 'someone-else@example.com', verified: false }],
          _json: { ...makeProfile()._json, email_verified: true },
        } as Partial<Profile>),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('refuses a profile with no email at all', () => {
    expect(() =>
      makeStrategy().validate(
        'token',
        '',
        makeProfile({
          emails: undefined,
          _json: { ...makeProfile()._json, email: undefined },
        }),
      ),
    ).toThrow(UnauthorizedException);
  });

  // Google has no username, and `displayName` is not guaranteed. The
  // fallback matters beyond the label: `findOrCreateUser` slugs it into the
  // new user's workspace name.
  it('falls back to the email local part when there is no display name', () => {
    const user = makeStrategy().validate(
      'token',
      '',
      makeProfile({ displayName: '  ' }),
    );
    expect(user.username).toBe('ada');
  });

  // Same contract as GitHubStrategy: a login that reached the provider with
  // no `state` is one the callback would refuse, so it could never return.
  it('forwards the state the guard attached', () => {
    const strategy = makeStrategy();
    const authenticate = jest
      .spyOn(
        Object.getPrototypeOf(Object.getPrototypeOf(strategy)) as {
          authenticate: (req: Request, opts?: unknown) => void;
        },
        'authenticate',
      )
      .mockImplementation(() => undefined);

    strategy.authenticate({ __oauthState: 'web.abc' } as unknown as Request);
    expect(authenticate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ state: 'web.abc' }),
    );

    // A request no guard ran on carries no state, and must not be given
    // one here — it is not a login start.
    strategy.authenticate({} as unknown as Request);
    const opts = authenticate.mock.calls[1][1] as Record<string, unknown>;
    expect(opts.state).toBeUndefined();

    authenticate.mockRestore();
  });
});
