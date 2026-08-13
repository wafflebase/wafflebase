# Scripts

Repository automation: the verification harness, the task-doc tooling, the
agent pipeline, and the git hooks. Nothing here is published — these run from
root `package.json` scripts, `.github/workflows/ci.yml`, or `.githooks/`.

Design: [harness-engineering.md](../docs/design/harness-engineering.md).

## Verification harness

`verify-self.mjs` and `verify-ci.mjs` are the two runners; the rest are
individual gates they (or CI, or a package script) invoke.

| Script | Entry point | Role |
|--------|-------------|------|
| `verify-self.mjs` | `pnpm verify:self` | The lane runner and the `pre-push` hook. Owns the lane graph (builds, typechecks, tests, per-package checks), writes `.harness-reports/`. |
| `verify-ci.mjs` | `pnpm verify:ci` | The runner for lanes that need services — browser and integration. |
| `changed-areas.mjs` | — | Resolves which lanes a change can possibly affect. One resolver, two consumers: `verify-self.mjs` and `ci.yml`'s `changes` job, so they can never disagree. |
| `verify-browser-lanes.mjs` | — | Browser lane for `verify-ci.mjs`; degrades to a skip when Playwright is unavailable. |
| `verify-frontend-chunks.mjs` | `pnpm verify:frontend:chunks` | Enforces the frontend chunk-count and per-chunk KB budgets from `harness.config.json`. |
| `verify-dts-entries.mjs` | `pnpm verify:dts` | Asserts each engine package's published type entry actually resolves. Consumers set `skipLibCheck`, so a holey `dist/` would otherwise degrade to `any` silently. |
| `verify-entropy.mjs` | `pnpm verify:entropy` | Dead code (knip), dead links out of `docs/design/*.md`, and dependency freshness. |
| `verify-doc-index.mjs` | `pnpm verify:doc-index` | The complement of the entropy link check: asserts every package, every design doc, and every **top-level** entry of `scripts/` is *reachable from* its index file. Files nested inside a listed directory are not demanded. |
| `verify-integration.mjs` | `pnpm verify:integration` | DB-backed integration suites. |
| `verify-integration-local.mjs` | `pnpm verify:integration:local` | The same against a local Postgres. |
| `verify-integration-docker.mjs` | `pnpm verify:integration:docker` | Brings up Postgres in Docker, then runs the above. |
| `verify-integration-repeat.mjs` | `pnpm verify:integration:repeat` | Repeats the integration suites to surface flakes. |
| `verify-pipeline-drift.mjs` | — | Run by `ci.yml`: fails when `scripts/agent/` differs from the pinned `wafflebase/agent-pipeline` commit it mirrors. |
| `vendor-pipeline.mjs` | — | Verifies `scripts/agent/vendor/` against its sha256 manifest (offline, and what `ci.yml` runs); `--write` with a `--pipeline-dir` checkout refreshes it. The vendored copy is a pinned dependency — nobody edits it by hand. |
| `run-browser-tests-docker.sh` | `pnpm verify:browser:docker` | Runs the visual/interaction suites in Docker so font rendering matches CI. |

## Task docs

| Script | Entry point | Role |
|--------|-------------|------|
| `tasks-index.mjs` | `pnpm tasks:index` | Regenerates `docs/tasks/README.md` from the task files. Never hand-edit that index. |
| `tasks-archive.mjs` | `pnpm tasks:archive` | Moves completed task pairs from `docs/tasks/active/` to `archive/`, then reindexes. Keys on unchecked boxes only, so read a todo's Review section before trusting it. |

## Directories

| Directory | Contents |
|-----------|----------|
| [`agent/`](agent/) | The autonomous issue → PR pipeline: hunters, review panel, evaluation harness. A **standalone npm package outside the pnpm workspace**, so `pnpm verify:fast` never reaches it — the `agent:tests` lane in `verify-self.mjs` is what runs its suites. Mirrors a pinned commit of `wafflebase/agent-pipeline`; `verify-pipeline-drift.mjs` guards the copy. See [`agent/eval/README.md`](agent/eval/README.md). |
| `hooks/` | Shell hooks wired into `.claude/settings.json` and run by Claude Code (`session-prime.sh`, `guard-generated-files.sh`, `require-ai-disclosure.sh`, `check-arch-boundary.sh`, `post-task-reminder.sh`). Distinct from `.githooks/`, which git runs. |
| `test/` | `node --test` suites for the top-level scripts above, run by the `scripts:tests` lane in `verify-self.mjs`. Nothing else reaches them — `pnpm verify:fast` does not. |
