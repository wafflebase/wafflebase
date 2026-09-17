---
title: observability
target-version: 0.6.12
---

# Observability — Sentry error tracking and tracing

## Summary

Unhandled errors and performance traces from both halves of the app, reported
to Sentry: `@sentry/react` in `packages/frontend`, `@sentry/nestjs` in
`packages/backend`. Two Sentry projects, not one. Frontend stack traces
de-minify through source maps uploaded at build time.

Every part of it is **off unless a deployment configures it**, which is the
design constraint the rest of this document keeps returning to.

## Goals / Non-Goals

**Goals**

- Unhandled exceptions from the browser and the API server, attributed to a
  release.
- Readable frontend stack traces (source maps uploaded, never served).
- Page-load and request traces, linked across the two projects.
- A root error boundary, so a render throw shows something other than a blank
  page.

**Non-Goals**

- **Session replay.** It records document content, which needs a masking
  policy this project has not written, and it is the heaviest thing the SDK
  ships.
- **Profiling**, **Sentry logging** (the backend has `nestjs-pino`), the
  **SCM integration** (suspect commits), and alert routing beyond the project
  default.
- **PII.** `sendDefaultPii` is `false` on both halves; see §5.

## Proposal Details

### 1. Two projects

| Project              | Platform | Project ID         | Covers               |
| -------------------- | -------- | ------------------ | -------------------- |
| `wafflebase`         | React    | `4511444694335488` | `packages/frontend`  |
| `wafflebase-backend` | Nest.js  | `4512101894979584` | `packages/backend`   |

Split rather than merged because the two halves have different release
artifacts (one has source maps, one does not), different volumes, and
different people looking at them. Traces still connect across the boundary —
that is what §4 is about — so the split costs nothing analytically.

A DSN is a **public** value: it ships inside the browser bundle by design and
authorizes writing events into one project and nothing else. It is configured
through `vars.*`, not `secrets.*`, for the same reason
`VITE_YORKIE_PUBLIC_KEY` is.

### 2. Nothing is on by default

`VITE_SENTRY_DSN` and `SENTRY_DSN` are optional and empty by default, and
empty means `Sentry.init` is **never called** — not called with a falsy DSN,
which would still install global handlers and still patch `fetch`.

This is the property a committed `packages/frontend/.env.production` once
broke: every fork and self-host that built with no overrides silently
addressed wafflebase's own backend, Yorkie project and Google Analytics
property, with nothing failing visibly. A DSN baked in as a default would
restore exactly that bug with users' error reports and URLs as the payload.
`packages/frontend/tests/sentry-init.test.ts` asserts the no-call, because
this is the kind of default that erodes quietly.

The same shape protects the deploy ordering in §4.

### 3. Source maps

Keyed on **`SENTRY_AUTH_TOKEN` alone**, not on the DSN. The token is the one
value here that is a real secret, it exists only where a release is actually
published, and a contributor who has none must get today's build exactly: no
`.map` files emitted, no upload attempted, no failure.

When it is present, `vite.config.ts` turns on `build.sourcemap`, adds
`sentryVitePlugin` last in the plugin list, and the plugin deletes the maps
from `dist` after uploading them — so the GitHub Pages deploy never publishes
this app's un-minified source. Measured: the deletion runs even when the
upload itself fails, so a bad token leaks nothing.

An upload failure is deliberately **not fatal** to the build. Sentry being
unreachable must not stop a release. The cost is that an expired token
degrades silently to minified traces, visible only in the deploy log.

### 4. Tracing across the boundary

The frontend attaches `sentry-trace` and `baggage` to requests bound for the
backend origin, which is what stitches a browser trace to the server's.

Two traps, both of which bit during implementation:

- **`backendOrigin()` returns the empty string on a same-origin deployment.**
  Sentry matches `tracePropagationTargets` entries as substrings, and every
  URL contains the empty string, so passing `[""]` would attach trace headers
  to *third-party* requests. The option is omitted instead, falling back to
  the SDK default of same-origin plus localhost.

- **The backend's `enableCors` uses an explicit `allowedHeaders` allow-list.**
  A preflight that does not list those two headers does not merely lose the
  trace — it fails the request. They are now listed. This makes a new frontend
  against an old backend a breaking combination, which §2 defuses: the
  frontend attaches nothing until an operator sets `VITE_SENTRY_DSN`, by which
  point the backend change has shipped.

`tracesSampleRate` defaults to `0.1` on both halves. A value outside `[0, 1]`
or unparseable falls back to the default rather than to `1.0` — a typo must
not become "sample everything", because that is the direction that costs
money.

Both halves report the same `release` string (the root `package.json`
version), so one deploy's frontend and backend events line up.

### 5. What is not sent

`sendDefaultPii` stays `false`, so Sentry collects no IP addresses, cookies or
request bodies. That matters more here than in a typical app: request bodies
on this backend carry document content — `BACKEND_JSON_BODY_LIMIT` is 25 MB
precisely because they carry inlined images — and URLs carry share tokens.
Turning PII on must come with scrubbing share tokens out of URLs, which is not
written.

The Vite plugin's build telemetry is disabled. We send this org our errors; we
did not agree to also send it timings for our builds.

### 6. Backend instrumentation ordering

`src/instrument.ts` is imported as the **first statement** of `main.ts`. The
SDK instruments `http`, `express` and `pg` by patching them as they are first
required, so anything loaded above that line is loaded unpatched and emits no
spans — silently, with no error and no missing-configuration warning. The
compiled `dist/main.js` was checked to confirm `require("./instrument")` stays
first.

No import-sorting rule is configured in that package today, so nothing
enforces or reverses the ordering. If one is added, it needs an exception
there.

`SentryGlobalFilter` is registered as an `APP_FILTER`. The backend had no
global exception filter, so nothing is displaced; the filter reports and then
delegates to Nest's default handling, and does not report `HttpException`s —
the 404s and 403s this codebase throws for ordinary refusals are decisions,
not failures, and would bury the real crashes.

## Risks and Mitigation

**Bundle weight.** `@sentry/react` ships in the main bundle whether or not a
DSN is configured — the error boundary references it unconditionally, so it
cannot be tree-shaken away. Measured cost: one added chunk (223 → 224 against
the 228 limit) at ~72 kB raw. The chunk-count headroom is now 4, which is
tight; the next feature that adds chunks may need the cap raised rather than
the code changed.

**A quiet half-configuration.** Setting `VITE_SENTRY_DSN` without
`SENTRY_AUTH_TOKEN` produces working error reporting with unreadable stack
traces, and nothing says so. Documented in `.env.production.example`; there is
no runtime check, because the frontend cannot know what the build environment
had.

**Quota.** A spreadsheet editor emits a lot of navigation. The 0.1 sample rate
is a guess, not a measurement — revisit it once there is a week of real
volume.
