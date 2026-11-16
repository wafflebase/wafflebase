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

- [ ] Dead prose: grep every doc, skill, command, README and comment outside
      the core for files, jobs, labels and env the switch removed
      (`fix-evidence`, the issue classifier, `scripts/agent/install-deps*`,
      "not used yet" notes on the toolchain action); check every path and
      command the `maintainer-merge` skill names
- [ ] `require-ai-disclosure.sh`: decide, from who still sets
      `WAFFLEBASE_AGENT_AUTONOMOUS`, whether to retire it or keep it
      local-only, and make every description match
- [ ] `scripts/agent-arms/classify.mjs`: remove it, its test and every
      mention, unless something still calls `record`
- [ ] `ci.yml` uploads `.harness-reports/` twice; keep one artifact
      (`ci-lane-reports`, the name the core downloads) and point
      `ci-report.yml` at it; update the tests that pin the names
- [ ] Root `pnpm.overrides`: remove entries that match no package in
      `pnpm-lock.yaml`, with the history of why each was added
- [ ] Upstream list: what the core itself would need to change
- [ ] `pnpm verify:self` (all lanes), actionlint, `npm ci && npm test &&
      npm run check:upstream` in `scripts/agent`
- [ ] PR body draft

## Review

## Upstream

