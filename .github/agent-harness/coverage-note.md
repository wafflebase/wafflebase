## What the mechanical lanes cover on this branch

These run on this PR and must pass before it can be promoted. A finding whose
whole content is "this would fail CI" costs a review round and tells the author
nothing they were not about to be told anyway.

ENFORCED — you may rely on these:
- `tsc --noEmit` in packages/sheets, slides, docs, notes, board and cli. `tsc`
  also runs inside the core and backend builds.
- `eslint . --max-warnings 0` in packages/frontend, `eslint scripts`, and the two
  architecture configs (frontend + backend `lint:arch`) — those are what enforce
  import boundaries.
- The suites RUN and must be green: vitest in frontend, sheets, slides, docs,
  notes, board and cli; jest in backend; node:test in scripts/agent; plus the
  browser visual + interaction lane and the Postgres/Yorkie integration lane.
- knip: unused files, unused exports, unused exported types.
- Frontend bundle budgets: per-chunk KB and total chunk count.
- Every backticked path inside any docs/design/**.md must resolve on disk — the
  check recurses, so the nested subsystem docs are covered too, not just the
  top-level ones.
- `pnpm audit`: fails the lane on a CRITICAL advisory, and on nothing below it.

NOT ENFORCED BY ANYTHING — a real finding here is worth MORE than one the lanes
above would have caught, because nothing else in the pipeline will catch it:
- Type errors in packages/frontend. It has no `tsc` at all — `vite build` strips
  types without checking them — and it is the largest package in the repo.
- eslint over packages/backend/src. Only its architecture config runs here.
- packages/core's own vitest suite. It has one; no lane invokes it. Only `tsc`
  via its build runs — and sheets, docs, slides and frontend all import it.
- `pnpm audit` findings below critical; high/moderate/low are printed and ignored.
- Formatting. Prettier is write-only in this repo and no lane checks it.
- Whether a passing test asserts anything. The lanes prove the suite is GREEN,
  never that it is ADEQUATE — a test that asserts nothing passes just as loudly.
