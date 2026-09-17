import * as Sentry from '@sentry/nestjs';

/**
 * Sentry initialization, isolated in its own module so `main.ts` can import it
 * as its very first statement.
 *
 * THAT ORDERING IS LOAD-BEARING, not style. The SDK's automatic
 * instrumentation works by patching `http`, `express` and `pg` at the moment
 * they are first required. Anything imported ahead of this file gets the
 * unpatched module and emits no spans — silently, with no error and no
 * missing-configuration warning. If an import sorter ever hoists something
 * above it in `main.ts`, tracing degrades and nothing fails.
 *
 * `SENTRY_DSN` is OPTIONAL and unset by default, and unset means `init` is
 * never called: no handlers installed, no network egress. A deployment that
 * wants error reporting supplies its own DSN, the same way it supplies its own
 * `DATABASE_URL`. Nothing here is specific to wafflebase's own Sentry org.
 */
const dsn = process.env.SENTRY_DSN;

/**
 * Share of transactions sampled for tracing. Not 1.0 — trace quota is the
 * first thing a real deployment exhausts. Anything that is not a number in
 * [0, 1] falls back to the default rather than becoming "sample everything",
 * because that is the direction a typo must not go.
 */
function tracesSampleRate(): number {
  const raw = process.env.SENTRY_TRACES_SAMPLE_RATE;
  if (!raw) return 0.1;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return 0.1;
  return parsed;
}

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    // Same string the frontend reports, so one deploy's two halves line up.
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: tracesSampleRate(),
    // Left at the default. Request bodies here carry document content
    // (BACKEND_JSON_BODY_LIMIT is 25MB because they carry inlined images) and
    // URLs carry share tokens, so turning this on needs a scrubbing policy
    // first.
    sendDefaultPii: false,
  });
}
