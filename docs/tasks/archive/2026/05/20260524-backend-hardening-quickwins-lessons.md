# Backend Hardening Quickwins — Lessons

Two production-breaking bugs slipped past the first round of work and
the pre-commit gate. The reviewer caught both via isolated repros. Both
are subtle enough to bite again, so they're worth pinning here.

## 1. `@nestjs/throttler` named buckets stack across every route

**The trap:** registering two named throttlers looks like "different
policies for different routes". It is not. The guard iterates *every*
named bucket on *every* request. So:

```ts
ThrottlerModule.forRoot({
  throttlers: [
    { name: 'default', ttl: 60_000, limit: 60 },
    { name: 'auth',    ttl: 60_000, limit: 10 },  // ← caps ALL routes at 10
  ],
});

@Throttle({ auth: { limit: 10, ttl: 60_000 } })  // ← does NOT scope opt-in
async login() { ... }
```

The `@Throttle({ auth: ... })` decorator only *overrides* the limit
for the `auth` bucket on that route. It does not turn the bucket on or
off. So adding a second named bucket with a lower limit silently caps
the entire app at the lowest limit.

**Correct pattern (one named bucket, per-route overrides):**

```ts
throttlers: [{ name: 'default', ttl: 60_000, limit: 60 }];

@Throttle({ default: { limit: 10, ttl: 60_000 } })  // stricter override
async login() { ... }
```

**How to apply:** Default to a single bucket. Only add a second named
bucket if you genuinely want it to apply to every route. To make a
route stricter, override the existing bucket; to make a route looser,
add `@SkipThrottle()` or override with a higher limit. Always write
the throttler spec against the *real* `app.module.ts` config — the
original `throttler.spec.ts` used `limit: 2` on a fresh module and
therefore couldn't see the topology bug.

## 2. Undecorated DTO classes break the global `ValidationPipe`

**The trap:** declaring a DTO as a TypeScript class (`class
CreateXyzDto { name: string }`) without any `class-validator`
decorators looks harmless. With NestJS' global `ValidationPipe({
whitelist: true, forbidNonWhitelisted: true })`, that class makes
every request return 400 with `unknownValue` or `whitelistValidation:
'property X should not exist'` on every property — class-validator
has nothing to validate against, so the whitelist treats every field
as illegal.

**Why we missed it:** the workspace / document / api-key DTOs all had
decorators added in commit 3 and worked fine. `datasource.dto.ts` was
already a class file with no decorators, so it slipped — and the e2e
suites were silently bypassing the global pipe (see lesson #3).

**How to apply:**
- Every DTO class that appears in a `@Body() dto: SomeDto` signature
  must have at least one `class-validator` decorator on at least one
  property, even if logically optional. The unit spec
  (`datasource.dto.spec.ts`) explicitly asserts no `unknownValue`
  error surfaces — that's the canary.
- When auditing a controller for the global pipe, grep
  `packages/*/src/**/*.dto.ts` and confirm each class has decorators
  before flipping `forbidNonWhitelisted: true` on.

## 3. E2E suites must replay the real bootstrap pipeline

**The trap:** `Test.createTestingModule(...).createNestApplication()`
gives you a Nest app, but it does *not* apply the global pipes /
filters / interceptors from `main.ts`. They live in the bootstrap
function, not in the module graph. So a green e2e suite proves
nothing about what production traffic actually hits.

**How to apply:**
- Add an `applyGlobalBootstrap(app)` helper next to
  `integration-helpers.ts` and call it from every e2e `beforeAll`.
  Keep it in lockstep with `main.ts`. If `main.ts` adds
  interceptors / filters in the future, update the helper in the
  same PR.
- When code review surfaces "test passes but prod breaks", check
  whether the test built its own Nest app and forgot the bootstrap
  layer.

## 4. Treat reviewer reproductions as ground truth, not opinions

The reviewer ran a 12-line standalone repro for each Critical and
included the exact output (`First 429 at request # 11`,
`whitelistValidation: 'property name should not exist'`). That short
script is more convincing than any amount of code reading. When I
ran the same script myself before fixing, both bugs reproduced in
<5 seconds.

**How to apply:** Before pushing back on a code review claim, write
the smallest repro that proves the claim wrong. If the repro lights
up, the reviewer was right and rebuttal is wasted time. The repro
also becomes the regression test once the fix lands.

## 5. Pre-commit `verify:fast` does not exercise the pipeline

`verify:fast` runs unit tests, lint, and typecheck. None of them
launch a NestJS HTTP app with the production middleware chain.
Critical #1 (throttler stacking) and Critical #2 (datasource DTOs)
both went green on `verify:fast` and would have shipped if the user
hadn't asked for a self-review.

**How to apply:** For backend changes that touch the bootstrap
pipeline (pipes, guards, interceptors, throttlers), run the
integration lane (`pnpm verify:integration`, gated on
`RUN_DB_INTEGRATION_TESTS=true`) before declaring done — or at
minimum a focused supertest spec that builds a real
`createNestApplication` and exercises the policy under test. The
in-memory throttler spec we added now mirrors the real config
(`src/throttler.spec.ts`); that's the model for similar policy
tests to come.
