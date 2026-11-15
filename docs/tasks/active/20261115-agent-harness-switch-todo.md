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

- [x] Sync from yorkie main `067875cd` with `sync.mjs --repository
      yorkie-team/yorkie`, committed alone
- [x] `lint:scripts` reads the core as yorkie writes it: style rules the core
      does not follow are off for `scripts/agent/**`, bug rules stay on
- [x] `repo.test.mjs`: flip the yorkie#2362 gap pin to a positive assertion;
      re-record `repo.snapshot.json` only if the rendered workflows changed;
      `npm test`, `npm run test:repo`, `npm run check:upstream` green
- [x] `scripts/test/agent-workflow-guards.test.mjs` rewritten for the
      canonical workflows: every property that still applies, expressed
      against the toolchain action and the report/finish jobs; checks for
      what no longer exists dropped with the reason; each kept property
      mutation-checked against the synced workflows
- [x] Whatever `pnpm verify:self` reports: workflow comments and docs that
      name deleted files, knip, doc index and links, CODEOWNERS
- [x] Docs in `docs/design/agent-pipeline/` that now describe something false
- [x] `pnpm verify:self` (all lanes), actionlint against the base
- [x] PR body draft; the merge needs `AGENT_PIPELINE_ENABLED` off during the
      switch

## Review

- Sync from `067875cd`: 141 files copied, 6 deleted; the configuration loads
  under the new schema with nothing to add or rename. `npm test` 1381/1381,
  `test:repo` 28/28, `check:upstream` OK. The rendered prompts did not change,
  so `repo.snapshot.json` stayed as recorded.
- The core fails three style rules of `lint:scripts`; they are off for
  `scripts/agent/**` only, `no-undef` stays on (checked with a planted
  undeclared identifier).
- `agent-workflow-guards.test.mjs`: 11 failures before, 158/158 after. Every
  kept property is checked against the toolchain action, the report jobs and
  the finish job; the digest checks, the staged `install-deps.mjs` and the
  `pnpm/action-setup` checks went with the steps they held. Two upstream
  differences are pinned as known gaps (GitHub's own actions at major tags,
  the reply job's silent refused install). 122 named fixture edits refused,
  16 accepted; 27 edits of the synced workflows each caught by the test that
  owns the property (scratch copy).
- The workspace-run guards missed `steps.<id>.outputs.ref`, the reply job's
  branch checkout; found by a mutation case, fixed.
- `release-guard.test.mjs` read the App's login from a workflow; it reads
  `.github/agent-harness/config.json` now.
- `pnpm verify:self`: all 30 lanes pass in 238 s: agent:tests 1381/1381,
  agent-arms:tests 647/647, scripts:tests 432 (429 pass, 3 skipped for want of
  a Linux filesystem or the pinned pnpm), verify:entropy clean.
  The first run failed only verify:entropy, for two reasons: knip could not
  spawn `npx` in the scrubbed environment used here (an environment issue, not
  a repository one), and a last reference to the deleted
  `scripts/agent/summarize-ci.mjs` remained in harness-engineering.md's
  roadmap (fixed).
- actionlint 1.7.12 (`-shellcheck= -pyflakes=`): clean at head and base.
