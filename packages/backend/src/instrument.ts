import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * This package's own version, which is kept in lockstep with the root
 * `package.json` the frontend bakes in as `__APP_VERSION__` — so with neither
 * side configured, both halves still report the SAME release and one deploy's
 * events line up.
 *
 * Without this the release had to be hand-synced with the container image tag
 * on every bump, and a missed bump does not fail: it silently attributes
 * backend errors to the wrong release, or to none at all.
 *
 * Read off disk rather than imported, for two independent reasons. A JSON
 * `import` would pull `package.json` into the TypeScript program, which moves
 * the inferred `rootDir` up a level and makes `nest build` emit `dist/src/...`
 * instead of `dist/...`, breaking every path in the image. A bare `require()`
 * avoids that but trips `@typescript-eslint/no-require-imports`, and the
 * disable comment for it is itself an error under `eslint.arch.config.mjs`,
 * which does not define that rule.
 *
 * `../package.json` resolves to the same file from `dist/` as from `src/` —
 * both sit one level under the package root — and the Dockerfile copies it
 * (`COPY packages/backend/package.json ./packages/backend/`). Anything
 * unexpected degrades to an unset release rather than taking the process down
 * at boot, since this runs before Nest even starts.
 */
function packageVersion(): string | undefined {
  try {
    const raw = readFileSync(join(__dirname, '../package.json'), 'utf8');
    return (JSON.parse(raw) as { version?: string }).version;
  } catch {
    return undefined;
  }
}

/** Empty string is how an unset value arrives from a k8s manifest or a `.env`
 * line with nothing after the `=`, and `??` would let it through. */
function nonEmpty(value: string | undefined): string | undefined {
  return value ? value : undefined;
}

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      nonEmpty(process.env.SENTRY_ENVIRONMENT) ?? process.env.NODE_ENV,
    // Same string the frontend reports, so one deploy's two halves line up.
    release: nonEmpty(process.env.SENTRY_RELEASE) ?? packageVersion(),
    tracesSampleRate: tracesSampleRate(),
    // Left at the default. Request bodies here carry document content
    // (BACKEND_JSON_BODY_LIMIT is 25MB because they carry inlined images) and
    // URLs carry share tokens, so turning this on needs a scrubbing policy
    // first.
    sendDefaultPii: false,
  });
}
