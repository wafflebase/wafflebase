---
paths:
  - "packages/frontend/**"
---

# Frontend

- Chunk-gate defaults live in `harness.config.json` (`frontend.chunkBudgets`); override with `FRONTEND_CHUNK_LIMIT_KB` / `FRONTEND_CHUNK_COUNT_LIMIT` / `FRONTEND_EAGER_LIMIT_KB`. Raising a cap needs a measured `*Reason` entry beside it.
- Unit tests are Vitest (`pnpm frontend test`); it picks up both `tests/**` and colocated `src/**/*.test.ts(x)`.
- Browser lanes need Chromium once: `pnpm --filter @wafflebase/frontend exec playwright install chromium`. Prefer `pnpm verify:browser:docker` for stable screenshots.
- A deliberate visual change regenerates baselines with `pnpm frontend test:visual:browser:docker:update`; never hand-edit baseline PNGs.
- Do not name functions under `src/api` `use*`: eslint react-hooks keys on the name and fails `verify:fast`.
