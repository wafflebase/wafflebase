# Move the Agent Arms out of scripts/agent — Task Tracking

wafflebase will take yorkie's shared harness core as a byte-identical copy:
everything under `scripts/agent/` and every `.github/workflows/agent-*.yml`,
written by yorkie's `sync.mjs`. A sync deletes every tracked file under the
core that the upstream lacks and refuses untracked ones, so wafflebase's own
features — the issue hunters, harvest, spec-to-pr, classify and the rest —
cannot stay inside `scripts/agent/`. This task moves them to
`scripts/agent-arms/` with no change in behaviour. It is step W1 of the
convergence plan; the config, toolchain action and the sync itself come later.

## Plan

- [x] Inventory every file under `scripts/agent/` that yorkie's core (main
      `0fa3f92f`) lacks, and decide for each: move to `scripts/agent-arms/`,
      move to `scripts/test/`, or stay for now with a reason
- [x] Cut the one core → arm import: `pick-fix-credential.mjs` takes
      `classifyRefusal` from `auth-smoke.mjs`. The staged
      `$RUNNER_TEMP/agent-tools` copy holds `scripts/agent` only, so the
      picker would fail to load once the arm moves
- [x] Move the wafflebase-specific suites of core files (`lint-config`,
      `test-lane`) to `scripts/test/`
- [x] Move the arms with `git mv`; rewrite imports (`./x.mjs` →
      `../agent/x.mjs`) and the path strings found by grep (`HERE/lenses`,
      `HERE/set-state.mjs`, `HERE/review-panel.mjs`, `HERE/node_modules`)
- [x] Resolve the SDK and zod for the arms through the core's package, so
      there is one install and one copy of each in a process
- [x] Workflows: `agent-implement.yml` runs `classify.mjs` from the new path;
      rename `agent-sdk-smoke-test.yml` to `sdk-smoke-test.yml` (the core glob
      `agent-*.yml` would delete it)
- [x] Guard: the workspace-run check in `agent-workflow-guards.test.mjs` also
      matches `scripts/agent-arms/`
- [x] Lanes and config: an `agent-arms:tests` lane in `verify-self.mjs`, the
      inert `agent` entry in `harness.config.json`, CODEOWNERS, docs and
      commands that name a moved path
- [x] Prove no behaviour change: per-file test counts before and after,
      `pnpm verify:self`, actionlint, each CLI's `--help`

## Inventory

Files under `scripts/agent/` that yorkie's core (main `0fa3f92f`) lacks:

| Files | Decision |
|---|---|
| `hunt*.mjs` (16 modules, 15 suites), `charters/`, `charters-ui/` | moved to `scripts/agent-arms/` |
| `harvest`, `misses.jsonl`, `finding-match`, `cache-report`, `spec-to-pr`, `read-review-verdict`, `classify`, `auth-smoke` (+ suites) | moved to `scripts/agent-arms/` |
| `lint-config.test.mjs`, `test-lane.test.mjs` | moved to `scripts/test/`: they test `eslint.config.mjs`, `verify-self.mjs` and the workflows, not the core; yorkie#2358 ported neither |
| `install-deps*` (4 files + suite) | stay: they belong in the per-repo toolchain action (`.github/actions/agent-toolchain/`), which is a later step; moving them now changes the install step of four jobs that the workflow guard pins |
| `summarize-ci.mjs` | stays: yorkie's core runs `scripts/ci/summarize-ci.mjs --dir` against a `ci-lane-reports` artifact. Moving it is a change of interface and of the CI-fix job's staging, which is the next step's, not a pure move |

## Review

- Arm tests, per file, before and after, with `scripts/agent/node_modules`
  absent (the lanes' condition): identical except `auth-smoke` +1 and
  `pick-fix-credential` −1 (the one moved vocabulary test) and the new
  `core-deps` suite. 1685 tests before; 1040 core + 642 arms after, plus 9
  moved to `scripts:tests` and 3 new lane-shape tests there.
- With the SDK installed, `hunt-tool.test.mjs` runs its SDK test (21 pass,
  as before) through `core-deps.mjs`, and `core-deps.test.mjs` checks the SDK
  and zod resolve to the files Node itself resolves from `scripts/agent`.
- Each CLI (`cache-report`, `classify`, `harvest`, `hunt`/`hunt-ui`
  `preflight`, `spec-to-pr`, `read-review-verdict`, `auth-smoke`) prints the
  same output before and after, with and without the SDK, but for
  `auth-smoke`'s "run `npm ci` in scripts/agent" (it said "this directory").
- actionlint 1.7.12: no findings.
