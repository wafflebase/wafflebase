# Switch to yorkie's Shared Harness Core — Task Tracking

**Created**: 2026-11-15

Step W4 of moving wafflebase's agent harness onto yorkie's shared core. W2
and W3 (#1150) made every convention the core assumes true here and wrote the
per-repository files (`.github/agent-harness/`,
`.github/actions/agent-toolchain/`). This task runs the sync: everything under
`scripts/agent/` and every `.github/workflows/agent-*.yml` becomes a copy of
yorkie-team/yorkie at `067875cd`, and what still describes or guards the old
copy is brought in line.

## Plan

- [ ] Sync from yorkie main `067875cd` with `sync.mjs --repository
      yorkie-team/yorkie`, committed alone
- [ ] `lint:scripts` reads the core as yorkie writes it: style rules the core
      does not follow are off for `scripts/agent/**`, bug rules stay on
- [ ] `repo.test.mjs`: flip the yorkie#2362 gap pin to a positive assertion;
      re-record `repo.snapshot.json` only if the rendered workflows changed;
      `npm test`, `npm run test:repo`, `npm run check:upstream` green
- [ ] `scripts/test/agent-workflow-guards.test.mjs` rewritten for the
      canonical workflows: every property that still applies, expressed
      against the toolchain action and the report/finish jobs; checks for
      what no longer exists dropped with the reason; each kept property
      mutation-checked against the synced workflows
- [ ] Whatever `pnpm verify:self` reports: workflow comments and docs that
      name deleted files, knip, doc index and links, CODEOWNERS
- [ ] Docs in `docs/design/agent-pipeline/` that now describe something false
- [ ] `pnpm verify:self` (all lanes), actionlint against the base
- [ ] PR body draft; the merge needs `AGENT_PIPELINE_ENABLED` off during the
      switch

## Review

(filled in as the work lands)
