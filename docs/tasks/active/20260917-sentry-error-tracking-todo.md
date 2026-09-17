# Sentry error tracking — frontend + backend

Wire Sentry into `packages/frontend` (React/Vite) and `packages/backend`
(NestJS): error tracking, source-map upload, and performance tracing.

## Console state (already done, 2026-09-17)

Two projects under the `wafflebase` Sentry org (`o4511444691714048`, US region):

| Project              | Platform | Project ID         | Covers               |
| -------------------- | -------- | ------------------ | -------------------- |
| `wafflebase`         | React    | `4511444694335488` | `packages/frontend`  |
| `wafflebase-backend` | Nest.js  | `4512101894979584` | `packages/backend`   |

`wafflebase` was created as a **Next.js** project — wrong for this repo, which
is Vite + React — and its platform has been corrected to React. The platform
field only selects which onboarding docs Sentry shows; it changes neither
ingestion nor the DSN, so nothing else was affected by the mismatch.

DSNs are **public values**. They ship inside a browser bundle by design and
authorize nothing but writing events into the project, which is why they live
in `vars.*` below rather than `secrets.*` — the same reasoning
`publish-ghpage.yml` already applies to `VITE_YORKIE_PUBLIC_KEY`.

- frontend: `https://07aabbc14c1ec8c017f7d576f99be30c@o4511444691714048.ingest.us.sentry.io/4511444694335488`
- backend: `https://30f47e5a338db1a1a193b5020951b3ca@o4511444691714048.ingest.us.sentry.io/4512101894979584`

The **auth token** for source-map upload is a real secret and is NOT created
here — see "Operator steps" at the bottom.

## Goals / Non-Goals

**Goals** — unhandled errors from both halves, readable (un-minified) frontend
stack traces, and request/page-load traces that link across the two projects.

**Non-Goals** — session replay (rejected: bundle weight, and it records
document content, which needs a masking policy we have not written), profiling,
Sentry logging, the SCM/GitHub integration (suspect-commits), and alert routing
beyond the project default.

## Design

### 1. Off unless configured, in both halves

`VITE_SENTRY_DSN` (frontend) and `SENTRY_DSN` (backend) are both **optional and
empty by default**. Empty means `Sentry.init` is never called: no SDK
initialization, no network request, no global handlers installed.

This is not caution for its own sake — it is the property
`.env.production.example` and `publish-ghpage.yml` were rewritten to protect.
A committed `.env.production` once made every fork and self-host report into
wafflebase's own backend, Yorkie project and Google Analytics property with
nothing failing visibly. A DSN baked in as a default would restore exactly that
bug, pointed at this Sentry org. So `VITE_SENTRY_DSN` follows `VITE_GA_ID`: the
value lives with the deployment that uses it, and a fork inherits none of it.

It also disposes of a deploy-ordering hazard on its own; see §4.

### 2. Frontend (`packages/frontend`)

- `@sentry/react` (dependency), `@sentry/vite-plugin` (devDependency).
- New `src/sentry.ts` — reads `import.meta.env.VITE_SENTRY_DSN`, returns
  immediately when falsy, otherwise `Sentry.init` with
  `browserTracingIntegration`.
  - `release: __APP_VERSION__` — the root `package.json` version, already
    injected by `vite.config.ts` `define`. Same string on both halves, so a
    frontend and backend event from one deploy correlate.
  - `environment` from `VITE_SENTRY_ENVIRONMENT`, defaulting to
    `import.meta.env.MODE`.
  - `tracesSampleRate` from `VITE_SENTRY_TRACES_SAMPLE_RATE`, default `0.1`.
    Not 1.0: the free plan's trace quota is small and a spreadsheet editor
    emits a lot of navigation.
- `main.tsx` calls it before `createRoot`, and before the existing
  `setCredentialedImageOrigins` call, so an error thrown during bootstrap is
  still captured.
- `App.tsx` gains a `Sentry.ErrorBoundary` at the router root. There is no
  existing error boundary anywhere in the package (checked), so today a render
  throw blanks the page with nothing reported.

### 3. Source maps

`sentryVitePlugin` is added to `vite.config.ts` **only when `SENTRY_AUTH_TOKEN`
is present in the build environment**, and `build.sourcemap` is turned on by
the same condition. Two consequences, both wanted:

- A local `pnpm frontend build` is byte-for-byte what it is today — no `.map`
  files, no upload attempt, no failure for a contributor with no token.
- The maps are generated for the upload and then deleted from `dist` by the
  plugin's `sourcemaps.filesToDeleteAfterUpload`, so the GitHub Pages deploy
  does not publish this app's un-minified source.

The chunk gate counts only `.js` files (`scripts/verify-frontend-chunks.mjs`
filters on `.name.endsWith(".js")`), so emitted maps cannot trip it. The SDK's
own weight can — `maxChunkKb` is 710 and `maxChunkCount` 228. Measure after the
first build rather than guessing.

### 4. Backend (`packages/backend`)

- `@sentry/nestjs` (dependency).
- New `src/instrument.ts` holding the `Sentry.init`, imported as the **very
  first line** of `main.ts`. This ordering is a hard requirement of the SDK,
  not a style preference: the auto-instrumentation patches `http`, `express`
  and `pg` as they are first required, so anything imported ahead of it is
  loaded unpatched and emits no spans. It needs an `eslint-disable` for
  import-order and a comment saying why, or the next lint autofix silently
  breaks tracing.
- `app.module.ts` gains `SentryModule.forRoot()` and `SentryGlobalFilter` as an
  `APP_FILTER`. The backend has no global exception filter today (checked), so
  nothing is displaced; `SentryGlobalFilter` reports and then delegates to
  Nest's default handling, and deliberately does not report the
  `HttpException`s this codebase throws for ordinary refusals (a 404 on a
  template tier is not an error).
- `main.ts` `enableCors` currently lists `allowedHeaders: ['Content-Type',
  'Authorization']`. **Distributed tracing needs `sentry-trace` and `baggage`
  added to that list.** Without them the browser's preflight rejects the
  headers the frontend SDK attaches to every backend call, and cross-origin API
  calls start failing outright — a worse outcome than having no tracing.

  That is also the deploy-ordering hazard: a new frontend against an old
  backend breaks. §1 defuses it — `VITE_SENTRY_DSN` is unset today, so the
  frontend attaches nothing until an operator sets it, by which time this
  backend change has shipped. Worth stating in the PR body anyway.

### 5. What is NOT sent

`sendDefaultPii` stays at its default (`false`) on both halves, so Sentry does
not collect IP addresses, cookies or request bodies. This matters more here
than in a typical app: request bodies on this backend carry document content
(`BACKEND_JSON_BODY_LIMIT` is 25 MB precisely because they carry inlined
images), and URLs carry share tokens. If PII is ever turned on, scrubbing share
tokens out of URLs has to come with it.

## Checklist

### Frontend

- [ ] Add `@sentry/react` + `@sentry/vite-plugin`
- [ ] `src/sentry.ts` — guarded init, release/environment/tracesSampleRate
- [ ] `main.tsx` — call it first
- [ ] `App.tsx` — `Sentry.ErrorBoundary` at the router root
- [ ] `vite.config.ts` — conditional plugin + `build.sourcemap`
- [ ] `.env.production.example` — document the three `VITE_SENTRY_*` variables
- [ ] Unit test: init is a no-op with an empty DSN

### Backend

- [ ] Add `@sentry/nestjs`
- [ ] `src/instrument.ts` + first-line import in `main.ts`
- [ ] `app.module.ts` — `SentryModule.forRoot()` + `SentryGlobalFilter`
- [ ] `enableCors` — allow `sentry-trace`, `baggage`
- [ ] `packages/backend/README.md` — env table

### CI / docs

- [ ] `publish-ghpage.yml` — `VITE_SENTRY_DSN` (vars), `SENTRY_AUTH_TOKEN` (secrets)
- [ ] `docs/design/` — a short observability doc, or a section in `frontend.md`/`backend.md`
- [ ] Update `docs/design/README.md` index if a new doc lands

### Verify

- [ ] `pnpm verify:fast`
- [ ] `pnpm frontend build` — chunk gate still green, record measured KB/count
- [ ] Throwaway local run with real DSNs: confirm one frontend and one backend
      event actually arrive, then revert the local env
- [ ] `pnpm verify:self` before push

## Operator steps (not automatable here)

1. Create an **organization auth token** at
   `https://wafflebase.sentry.io/settings/auth-tokens/` with the
   `project:releases` and `org:read` scopes. This is a secret — it is
   deliberately not created or read in this session.
2. Add it as the repository secret `SENTRY_AUTH_TOKEN`.
3. Add repository variables `VITE_SENTRY_DSN` (frontend DSN above) and, if the
   default is not wanted, `VITE_SENTRY_TRACES_SAMPLE_RATE`.
4. Set `SENTRY_DSN` (backend DSN above) in the backend deployment's
   environment.

Until step 3/4 happen, everything in this task is inert by design.

## Review

_(filled in when the work lands)_
