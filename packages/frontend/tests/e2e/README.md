# E2E Tests (Playwright Test)

Behavioral end-to-end tests that drive the real app. For visual /
pixel-diff regression see `packages/frontend/scripts/verify-visual-browser.mjs`;
for jsdom unit tests see `packages/frontend/tests/`.

## Run

```bash
# One-shot (recommended): builds + boots backend + frontend, runs e2e, tears down.
docker compose up -d                    # postgres + yorkie (once per machine)
pnpm verify:e2e:standalone

# Or, against a running dev stack:
docker compose up -d
WAFFLEBASE_E2E_AUTH=1 pnpm dev          # in one terminal
pnpm verify:e2e                         # in another
```

## Debug

```bash
pnpm frontend e2e:ui                    # Playwright UI mode
pnpm frontend e2e:debug                 # Inspector
npx playwright show-trace test-results/<test>/trace.zip
```

## Add a test

```bash
cp packages/frontend/tests/e2e/__template__.spec.ts \
   packages/frontend/tests/e2e/specs/<area>/<name>.spec.ts
```

Then fill in the TODOs. Imports: `import { test, expect } from '../fixtures'`.

## Add a fixture

Drop a new file in `fixtures/`, then re-export `test` from
`fixtures/index.ts` extending the existing chain. Every spec imports from
`../fixtures` only — never from `@playwright/test` directly.

## Selectors

Prefer `getByRole` / `getByText` / `getByLabel`. Fall back to
`data-testid` only if no semantic selector works; add the `data-testid`
to the component in the same PR.
