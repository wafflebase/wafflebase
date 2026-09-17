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

The **auth token** for source-map upload is a real secret; it was created in
the browser but its value was never read into the session — see "Operator
steps" at the bottom.

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
- A `Sentry.ErrorBoundary` at the tree root. There is no existing error
  boundary anywhere in the package (checked), so today a render throw blanks
  the page with nothing reported.

  **Landed in `main.tsx`, not `App.tsx` as planned.** Wrapping `App.tsx`'s
  tree meant re-indenting ~90 lines; wrapping `<App />` one level up is a
  three-line change and catches strictly more, because `ThemeProvider` writes
  its class onto `document.documentElement` rather than a wrapper — so the
  fallback is themed correctly from outside `App`, and a throw inside the
  provider tree is caught too.

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
  loaded unpatched and emits no spans.

  Planned an `eslint-disable` for import-order alongside it; **not needed and
  in fact harmful** — no import-sorting rule is configured in this package, and
  an `eslint-disable` naming an unconfigured rule is itself an error
  ("Definition for rule 'import/order' was not found"). A comment carries the
  constraint instead.
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

- [x] Add `@sentry/react` + `@sentry/vite-plugin`
- [x] `src/sentry.ts` — guarded init, release/environment/tracesSampleRate
- [x] `main.tsx` — call it first
- [x] `Sentry.ErrorBoundary` at the tree root (landed in `main.tsx`)
- [x] `vite.config.ts` — conditional plugin + `build.sourcemap`
- [x] `.env.production.example` — document the three `VITE_SENTRY_*` variables
- [x] Unit test: init is a no-op with an empty DSN

### Backend

- [x] Add `@sentry/nestjs`
- [x] `src/instrument.ts` + first-line import in `main.ts`
- [x] `app.module.ts` — `SentryModule.forRoot()` + `SentryGlobalFilter`
- [x] `enableCors` — allow `sentry-trace`, `baggage`
- [x] `packages/backend/README.md` — env table

### CI / docs

- [x] `publish-ghpage.yml` — `VITE_SENTRY_DSN` (vars), `SENTRY_AUTH_TOKEN` (secrets)
- [x] `docs/design/` — a short observability doc, or a section in `frontend.md`/`backend.md`
- [x] Update `docs/design/README.md` index if a new doc lands

### Verify

- [x] `pnpm verify:fast`
- [x] `pnpm frontend build` — chunk gate still green, record measured KB/count
- [x] Throwaway local run with real DSNs: confirm one frontend and one backend
      event actually arrive, then revert the local env
- [x] `pnpm verify:self` before push

## Operator steps

Done on 2026-09-17/18 — recorded because each one is a place a future
deployment has to repeat, not because any remains outstanding.

1. **Organization auth token** at
   `https://wafflebase.sentry.io/settings/auth-tokens/`, named
   `github-actions-sourcemaps`. Organization tokens take a **fixed `org:ci`
   scope** — Source Map Upload, Release Creation, Code Mappings — and offer no
   scope picker. (An earlier draft of this file said to select
   `project:releases` + `org:read`; that is the older *personal* token model,
   which org tokens supersede. The effective grant is the same.)

   The value was never read into the session: creation was driven in the
   browser and confirmed by probing only for *whether* an input held a
   `sntrys_`-prefixed string, never its contents. Sentry shows it once.
2. Repository **secret** `SENTRY_AUTH_TOKEN` ← that value.
3. Repository **variable** `VITE_SENTRY_DSN` ← the frontend DSN above.
   `VITE_SENTRY_ENVIRONMENT` and `VITE_SENTRY_TRACES_SAMPLE_RATE` are read from
   variables too, and left unset (defaults: build mode, and `0.1`).
   `SENTRY_ORG`/`SENTRY_PROJECT` are deliberately not set — `vite.config.ts`
   defaults both to `wafflebase` and treats the empty string Actions passes for
   an unset variable as absent.
4. **Backend env** lives in `yorkie-team/devops`, not in this repo:
   `k8s/wafflebase/deployment.yaml`, synced to the cluster by ArgoCD
   (`path: k8s/wafflebase`, `targetRevision: HEAD`). Landed as devops PR
   [#360](https://github.com/yorkie-team/devops/pull/360) — `SENTRY_DSN`,
   `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`, with **no image bump**:
   the values are inert on the running v0.6.11 image, which carries no Sentry
   code, so landing them early leaves the v0.6.12 bump a plain tag change.

   `SENTRY_RELEASE` is intentionally absent there rather than set to a
   placeholder: a value that does not match the running image would not fail,
   it would quietly attribute backend errors to the wrong release. It must be
   added in the same commit that moves the image tag.

Until step 3/4 happen, everything in this task is inert by design.

## Review

Landed as `Add Sentry error tracking to the frontend and backend`, plus the
follow-up commit carrying the two test files. Design written up in
`docs/design/observability.md`; lessons in the paired `-lessons.md`.

### Verified, not assumed

- **Backend event arrives.** Loaded the *compiled* `dist/instrument.js` the way
  `dist/main.js` does, with the real DSN, and threw through it. Landed as
  `WAFFLEBASE-BACKEND-1`. `flush()` resolved true.
- **Backend guard holds.** Same script with `SENTRY_DSN` deleted:
  `Sentry.getClient()` is `undefined` and `flush()` resolves `false` — the SDK
  is genuinely uninitialized, not initialized-with-a-falsy-DSN.
- **Frontend event arrives.** Dev server on :5199 with the real DSN, a genuine
  *unhandled* throw (not a manual capture) from the login route. Observed the
  `POST .../api/4511444694335488/envelope/` return **200**, and the issue
  appear as `WAFFLEBASE-1`, tagged `Unhandled`, route `/login`.
- **Import ordering survives compilation.** `require("./instrument")` is the
  first statement of `dist/main.js`.
- **Source maps, both branches.** Without `SENTRY_AUTH_TOKEN`: zero `.map`
  files in `dist`, no upload attempted. With a dummy token: the plugin runs,
  the upload fails 401, **the build still succeeds**, and `dist` still holds
  zero `.map` files — so a bad token leaks no source but also degrades
  silently. Both facts are now comments in `vite.config.ts`.
- **Chunk gate.** 224 JS chunks against the limit of 228 (baseline was 223 —
  the SDK adds one chunk, ~72 kB raw). Largest chunk unchanged. Headroom is
  down to 4.
- **`pnpm verify:fast`** green (exit 0), run again by the pre-commit hook.
- **Unit tests**: `tests/sentry-init.test.ts` (4) and
  `tests/app-crash-fallback.test.tsx` (2) pass.

### Not verified here

- **A real source-map upload.** Needs a genuine `SENTRY_AUTH_TOKEN`, which was
  deliberately not created in this session. The first `publish-ghpage` run
  after the operator adds it is the real test; check that a frontend stack
  trace de-minifies.
- **Cross-boundary trace linking.** Both halves emit traces, but no run had
  the frontend and backend configured at once against a live API, so the
  `sentry-trace` header actually stitching a browser trace to a server one is
  argued from the CORS allow-list, not observed.
- **`pnpm verify:self` / browser lanes.** Run by the pre-push hook.

### Left behind

Two smoke-test issues, `WAFFLEBASE-1` and `WAFFLEBASE-BACKEND-1`, both titled
"… safe to resolve". Left in place deliberately as the evidence above; resolve
them from the Sentry UI whenever.
