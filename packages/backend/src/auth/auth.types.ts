import { User } from '@prisma/client';
import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  user: User & {
    isApiKey?: boolean;
    workspaceId?: string;
    scopes?: string[];
  };
}

/**
 * Why an OAuth provider's profile cannot become a sign-in.
 *
 * Reported as a **value** rather than thrown. A strategy's `validate()` runs
 * inside `AuthGuard(...)`, i.e. before the callback handler, so a throw there
 * escapes as backend JSON and skips the whole refusal contract the callback
 * owns: a browser login is supposed to land back on `FRONTEND_URL/login?error=`
 * (the codes `login-form.tsx` maps), and a CLI login is supposed to be told at
 * its loopback callback rather than left blocking until the five-minute
 * timeout. Only the callback knows which of the two it is, so the strategies
 * hand it the reason and it routes it.
 */
export const OAUTH_REFUSAL_CODES = [
  'unverified_email',
  'no_email',
  'email_conflict',
] as const;

export type OAuthRefusalCode = (typeof OAUTH_REFUSAL_CODES)[number];

/** What a strategy returns for a profile it refuses. */
export interface OAuthRefusal {
  authProvider: string;
  error: OAuthRefusalCode;
}

/** The profile fields the callback reads off a successful `validate()`. */
export interface OAuthProfile {
  authProvider: string;
  username?: string;
  email?: string;
  photo?: string;
}

/** The refusal code carried by a strategy result, if it is one. */
export function oauthRefusal(user: unknown): OAuthRefusalCode | undefined {
  const code = (user as { error?: unknown } | undefined)?.error;
  return typeof code === 'string' &&
    (OAUTH_REFUSAL_CODES as readonly string[]).includes(code)
    ? (code as OAuthRefusalCode)
    : undefined;
}
