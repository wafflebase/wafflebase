import { ForbiddenException } from '@nestjs/common';
import { TemplateReviewerGuard } from './template-reviewer.guard';

function contextFor(user: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

function guardWith(allowlist: string | undefined) {
  const config = { get: () => allowlist };
  return new TemplateReviewerGuard(config as never);
}

describe('TemplateReviewerGuard', () => {
  it('admits a user on the allowlist', () => {
    expect(guardWith('7,9').canActivate(contextFor({ id: 9 }))).toBe(true);
  });

  it('admits a string id, which is what the JWT payload carries', () => {
    expect(guardWith('7').canActivate(contextFor({ id: '7' }))).toBe(true);
  });

  it('refuses a user who is not on it', () => {
    expect(() => guardWith('7').canActivate(contextFor({ id: 9 }))).toThrow(
      ForbiddenException,
    );
  });

  it('refuses everyone when the allowlist is unset', () => {
    // No reviewers configured means no review pipeline, so the public tier
    // stays shut rather than opening to whoever happens to be signed in.
    expect(() =>
      guardWith(undefined).canActivate(contextFor({ id: 7 })),
    ).toThrow(ForbiddenException);
  });

  it('refuses an unauthenticated request rather than treating it as allowed', () => {
    // This guard answers "may this user review", not "who is this user" — it
    // stacks after JwtAuthGuard. A request arriving with no user is a
    // misconfiguration, and the safe reading of one is "no".
    expect(() => guardWith('7').canActivate(contextFor(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('refuses a non-numeric id', () => {
    expect(() =>
      guardWith('7').canActivate(contextFor({ id: 'seven' })),
    ).toThrow(ForbiddenException);
  });
});
