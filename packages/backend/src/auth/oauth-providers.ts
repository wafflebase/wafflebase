/**
 * Which OAuth providers this deployment can actually sign somebody in with.
 *
 * GitHub is not optional — it is the login every install is configured for,
 * and the CLI flow is built on it. Google is, and it has to be: adding a
 * second strategy unconditionally would mean `passport-google-oauth20`
 * throwing `OAuth2Strategy requires a clientID option` at boot on every
 * existing deployment, which turns a new feature into an outage for
 * everyone who does not want it.
 *
 * Read off `process.env` rather than `ConfigService` for the same reason
 * `oauth-state.ts` and `github-auth.guard.ts` do: the answer is needed
 * while the module's provider list is being built, before any injector
 * exists.
 */

/** The three variables a working Google login needs. */
const GOOGLE_VARS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_CALLBACK_URL',
] as const;

function googleVarsSet(): number {
  return GOOGLE_VARS.filter((name) => (process.env[name] ?? '').trim() !== '')
    .length;
}

/**
 * Whether `GET /auth/google` is served.
 *
 * `GOOGLE_CALLBACK_URL` counts, unlike GitHub's, where an unset callback URL
 * is a working install: GitHub falls back to the URL registered on the OAuth
 * app, and Google does not — its authorization endpoint requires an explicit
 * `redirect_uri` and answers `redirect_uri_mismatch` without one. A login
 * that can only fail at Google is worse than a button that is not there.
 */
export function googleAuthConfigured(): boolean {
  return googleVarsSet() === GOOGLE_VARS.length;
}

/**
 * Some but not all of them — a typo, or a half-finished setup. Worth one
 * warning at boot, because the symptom is otherwise a button that silently
 * never appears.
 */
export function googleAuthPartiallyConfigured(): boolean {
  const set = googleVarsSet();
  return set > 0 && set < GOOGLE_VARS.length;
}

/** The names of the variables that are still missing, for that warning. */
export function missingGoogleAuthVars(): string[] {
  return GOOGLE_VARS.filter((name) => (process.env[name] ?? '').trim() === '');
}
