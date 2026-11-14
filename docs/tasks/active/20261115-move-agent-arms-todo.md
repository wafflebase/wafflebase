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

- [ ] Inventory every file under `scripts/agent/` that yorkie's core (main
      `0fa3f92f`) lacks, and decide for each: move to `scripts/agent-arms/`,
      move to `scripts/test/`, or stay for now with a reason
- [ ] Cut the one core → arm import: `pick-fix-credential.mjs` takes
      `classifyRefusal` from `auth-smoke.mjs`. The staged
      `$RUNNER_TEMP/agent-tools` copy holds `scripts/agent` only, so the
      picker would fail to load once the arm moves
- [ ] Move the wafflebase-specific suites of core files (`lint-config`,
      `test-lane`) to `scripts/test/`
- [ ] Move the arms with `git mv`; rewrite imports (`./x.mjs` →
      `../agent/x.mjs`) and the path strings found by grep (`HERE/lenses`,
      `HERE/set-state.mjs`, `HERE/review-panel.mjs`, `HERE/node_modules`)
- [ ] Resolve the SDK and zod for the arms through the core's package, so
      there is one install and one copy of each in a process
- [ ] Workflows: `agent-implement.yml` runs `classify.mjs` from the new path;
      rename `agent-sdk-smoke-test.yml` to `sdk-smoke-test.yml` (the core glob
      `agent-*.yml` would delete it)
- [ ] Guard: the workspace-run check in `agent-workflow-guards.test.mjs` also
      matches `scripts/agent-arms/`
- [ ] Lanes and config: an `agent-arms:tests` lane in `verify-self.mjs`, the
      inert `agent` entry in `harness.config.json`, CODEOWNERS, docs and
      commands that name a moved path
- [ ] Prove no behaviour change: per-file test counts before and after,
      `pnpm verify:self`, actionlint, each CLI's `--help`

## Review

(filled in when done)
