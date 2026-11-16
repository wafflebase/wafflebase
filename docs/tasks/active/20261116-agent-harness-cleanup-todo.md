# Clean Up After the Switch to yorkie's Shared Harness Core — Task Tracking

**Created**: 2026-11-16

Step W5 of moving wafflebase's agent harness onto yorkie's shared core. #1159
made `scripts/agent/**` and every `.github/workflows/agent-*.yml` a copy of
yorkie-team/yorkie (core at `92d86fc9`). This task removes what the switch
left behind on wafflebase's side: prose about jobs and files that are gone,
a script and an artifact nothing reads any more, and package overrides that
match nothing. The synced files are not edited; what they need goes to the
upstream list below.

## Plan

- [x] Dead prose: grep every doc, skill, command, README and comment outside
      the core for files, jobs, labels and env the switch removed
      (`fix-evidence`, the issue classifier, `scripts/agent/install-deps*`,
      "not used yet" notes on the toolchain action); check every path and
      command the `maintainer-merge` skill names
- [x] `require-ai-disclosure.sh`: decide, from who still sets
      `WAFFLEBASE_AGENT_AUTONOMOUS`, whether to retire it or keep it
      local-only, and make every description match
- [x] `scripts/agent-arms/classify.mjs`: remove it, its test and every
      mention, unless something still calls `record`
- [x] `ci.yml` uploads `.harness-reports/` twice; keep one artifact
      (`ci-lane-reports`, the name the core downloads) and point
      `ci-report.yml` at it; update the tests that pin the names
- [x] Root `pnpm.overrides`: remove entries that match no package in
      `pnpm-lock.yaml`, with the history of why each was added
- [x] Upstream list: what the core itself would need to change
- [x] `pnpm verify:self` (all lanes), actionlint, `npm ci && npm test &&
      npm run check:upstream` in `scripts/agent`
- [x] PR body draft

## Review

- Classifier: `classify.mjs record` had no caller after #1159, and nothing
  read its `agent-class` comment or `type:`/`bugclass:` labels. Removed with
  its test; it was the last `ANTHROPIC_API_KEY` use in any workflow, so the
  repository secret can go. The guard fixture that named it as a trusted
  post-agent step names `scripts/agent/metrics.mjs record` instead (161/161).
- Disclosure hook: kept, local-only. `/spec-to-pr` exports
  `WAFFLEBASE_AGENT_AUTONOMOUS` and `spec-to-pr.mjs handoff` refuses commits
  without the trailer; the hook moves that refusal to commit time. The docs
  had claimed CI checks the trailer. It does not: the shared report jobs write
  a PR-body disclosure (`disclose-pr.mjs`) and `mark-ready.mjs` checks the body.
- Lane reports: uploaded once as `ci-lane-reports`; `ci-report.yml` downloads
  that name into the same `harness-reports/` directory. The pinning test fails
  when `ci-report.yml` reads another name and when `ci.yml` uploads
  `.harness-reports/` twice (both checked on a scratch copy).
- Overrides: `hono` and `ip-address` match no package in `pnpm-lock.yaml`
  since #1132 removed the MCP SDK devDependency. Every other override still
  matches. The core's npm lockfile meets every floor the old `scripts/agent`
  overrides set. `pnpm install --frozen-lockfile` passes and a lockfile-only
  install leaves the lockfile unchanged.
- Dead prose: the toolchain action's "not used yet", the install script's
  "today's workflows", the toolchain suite's claim that `test:repo` imports
  it, `scripts/agent` "to become" the core, and the `fix-evidence` job.
  The agent-task template's `@claude implement this` is not a verb any
  workflow knows (`@claude fix`). Every path and command in
  `maintainer-merge` exists; it now says the last push needs someone else's
  approval.
- `pnpm verify:self`: all 30 lanes pass in 255 s (agent:tests 1437/1437,
  agent-arms:tests 637/637, scripts:tests 440: 437 pass, 3 skipped). The first
  run, at a load near 26, failed only `frontend:test` with vitest workers that
  could not start; two commits' hooks failed the same way and passed on retry.
- `scripts/agent`: `npm ci && npm test` 1437/1437, `check:upstream` OK at
  `92d86fc9`; no file under `scripts/agent/` or `agent-*.yml` changed.
- actionlint 1.7.12 (`-shellcheck= -pyflakes=`): clean.

## Upstream

Recorded in `.github/agent-harness/README.md` under "Upstream candidates":

- `scripts/agent/disclosure.mjs`'s header says no local arm sets the trailer
  hook's variable; here `/spec-to-pr` does.
- A `checks.test.mjs` comment says `agent-iterate-ci.yml` and
  `ci-report.yml` are not ported; both exist here.

