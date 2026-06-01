# Lessons — E2E Testing with @playwright/test

Paired with [20260601-e2e-playwright-test-todo.md](20260601-e2e-playwright-test-todo.md)
and design [docs/design/e2e-testing.md](../../design/e2e-testing.md).

## What surprised us

### 1. The plan's POC selectors were guesses; reality diverged on three axes

The plan referenced "New Slides", `/document/:id`, and a "My Documents"
heading. The actual dashboard:

- Uses `<DropdownMenu>` (Radix) with a "New" trigger button — items
  `New Sheet` / `New Document` / `New Presentation`. No "New Slides".
- Routes presentations to `/p/:id`, not `/document/:id`.
- Has no `<h1>` heading; the visible-marker for "documents page ready"
  is the `Filter by title…` input.

The POC spec, the `data-testid` placements, and the URL regex all had
to be adjusted in Task 4. **Takeaway:** before writing an e2e spec,
spend five minutes confirming the actual route + selector shape rather
than trusting plan text. The plan author worked from memory of "how a
dashboard probably works" and was wrong on every detail.

### 2. NestJS module-gating defeats `jest.isolateModulesAsync`

Task 2's plan called for two e2e cases in one file — one with the env
unset (404), one with the env set (200 + cookies) — using
`jest.isolateModulesAsync` to re-import `AppModule` with a fresh
module cache between them.

In practice, `@nestjs/core` re-loaded inside `isolateModulesAsync`
becomes a separate module instance. The `ThrottlerGuard` injects
`Reflector`, but Nest's `TestingInjector` does class-identity checks
against the original `Reflector` import — they no longer match, and
DI fails.

The first attempt worked around this by patching the cached
`AuthModule`'s `controllers` metadata via `Reflect.defineMetadata`.
This was worse than no test: it mutated module metadata for the
remainder of the Jest process AND it stopped exercising the actual
env-driven path (it tested the patch instead).

**Final shape:** keep only the 404 case in
`test-auth.e2e-spec.ts` (which IS the security-critical direction —
"production deploys cannot serve this route"). The 200-direction is
covered naturally by the Playwright auth fixture: every e2e spec
POSTs `/test/auth/login` on first use, so a regression breaks the
whole Playwright lane. Documented in the file's header comment so
future readers don't add it back.

### 3. Code review caught two production-relevant nits

The original `TestAuthController`:

- `throw new Error(...)` → became 500 + raw stack instead of clean JSON.
  Fixed to `InternalServerErrorException`.
- `secure: false` hardcoded on the cookie. Production `AuthController`
  derives it from `NODE_ENV`. Closing the gap defends-in-depth against
  the route ever mounting in a production-like env (which would still
  require the gate failing first).

Both were one-line fixes that mattered in principle even though the
env gate makes them unreachable in practice. **Takeaway:** even on
test-only code, mirror production patterns so the codebase stays
self-consistent and so a future env-gate slip doesn't expose a worse
shape than the rest of the code.

### 4. `harness.config.json` doesn't carry a lane schema

The first draft of the design doc said the new lane would add a
`lanes:` entry with `requires:` hints to `harness.config.json`. Reading
the actual file showed it only contains `frontend.chunkBudgets` and
`entropy` settings — there's no `lanes:` schema yet. Rather than
invent one for a single use case, the design doc was amended to defer
that schema and the standalone orchestrator
(`scripts/run-e2e-standalone.mjs`) emits actionable preflight hints
itself ("DATABASE_URL is unset", "docker compose up -d", etc.).

### 5. POC chose chromium-desktop only; mobile branch deliberately untagged

`slides-detail.tsx` has separate `DesktopSlidesLayout` and
`MobileSlidesLayout` branches. The `data-testid="slides-editor"` went
only on the desktop branch because the Playwright config has only the
`chromium-desktop` project. Adding a `chromium-mobile` project (and
its testid) is straightforward when a mobile-specific spec lands —
not before.

## What worked well

- **Tight subagent dispatches with full task text + scene-setting
  context** kept implementers focused. Each one read at most 2–3
  source files of its own; the controller didn't bleed the whole
  conversation into them.
- **Two-stage review (spec → code quality)** caught both
  spec-divergences (the `Reflect.defineMetadata` workaround) and
  code-quality nits (exception type, cookie secure flag) in
  separate, easy-to-action passes.
- **Plan↔reality divergences were documented in commit messages**
  (Task 4's commit explicitly names "the plan referenced 'New Slides'
  and '/document/:id'; actual labels are 'New Presentation' and
  '/p/:id'"). Future archaeologists won't have to git-blame to
  understand why the file diverges from the plan.

## What to remember next time

- **First five minutes of any e2e task: open the actual route in a
  browser and inspect the DOM**, before writing or even refining the
  spec. Save five iterations downstream.
- **NestJS module re-import isolation in Jest is unsolved in the
  general case.** If a test needs to re-construct a module under
  different env, the answer is usually a separate child process, not
  `jest.isolateModulesAsync`.
- **For tests of security gates, prefer the negative direction.** The
  "absence" assertion (404 when env unset) is what locks production
  safety; the positive direction is often naturally covered by
  downstream tests that depend on it.
