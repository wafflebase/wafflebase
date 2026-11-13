# Remove the eval subsystem

Issue: #1131 — `capture-collect.yml` has failed on every run since
2026-10-04 (`Bad credentials` on `EVAL_STORE_TOKEN`), and `eval-score.yml`
weekly since 2026-10-05 for the same reason. `eval-replay.yml` last ran on
2026-08-24. Nobody uses the benchmark now, so rather than rotate a PAT for
idle machinery, remove it. The live review panel must behave identically.

Accepted loss: ~75 uncollected stage-detail artifacts (oldest 2026-10-07)
expire from 2027-01-05. The external store repo
`dlgpdmsly2/wafflebase-agent-eval` keeps what it already has.

## Delete

- [x] `.github/workflows/capture-collect.yml`, `eval-score.yml`, `eval-replay.yml`
- [x] `scripts/agent/eval/` (whole directory)
- [x] `scripts/agent/collect-captures.mjs`, `capture-store.mjs`, `capture-meta.mjs` (+ tests)
- [x] `docs/design/agent-pipeline/eval-harness-usage.md`

## Panel: stop producing the capture (no behavior change otherwise)

- [x] `review-panel.mjs`: drop the `buildStageDetail`/`writeStageDetail` call,
      `stageDetailCaptureEnabled`, `stageDetailDiffContentEnabled`,
      `lensDiffMetadata`, and the now-unused `createHash` import; keep
      `annotatedFresh` (still feeds `keepUnrefuted`)
- [x] `review-panel.test.mjs`: drop capture-only tests; keep the generic
      hidden-path upload test minus its stage-detail half
- [x] `agent-review-panel.yml` / `agent-review-on-demand.yml`: drop
      `STAGE_DETAIL_*` env, "Describe the capture", "Upload per-lens stage detail"

## Fix what the deletion breaks

- [x] `verify-self.mjs` `agent:tests`: single invocation again (the second
      run existed only for `eval/run.test.mjs`); keep the timeout, no force-exit
- [x] `finding-match.test.mjs`: inline fixture instead of `eval/finding-record.mjs`
- [x] `checks.test.mjs`: drop the `capture-collect.yml` guard block
- [x] Relocate the two live guards from `eval/test-lane.test.mjs` (lane covers
      every test file; agent workflows' github-script steps set retries) into
      `checks.test.mjs`
- [x] `token-pool.mjs`: remove the eval-replay-only `shard` option + its tests

## Docs / comments

- [x] Workflow chain-depth comments (`ci-report`, `publish-ghpage`,
      `docker-publish`) — the panel chain has headroom again
- [x] Comment references in `deferred-findings.mjs`, `finding-match.mjs`,
      `finding-key.mjs`, `classify.mjs`, `report-verify.mjs`, `verify-self.mjs`
- [x] `scripts/README.md`, `docs/design/README.md`, `agent-pipeline.md`,
      `harness-engineering.md`, `agentic-office-workflow.md`, `debug-report.md`,
      `20260814-claude-token-pool-todo.md`
- [x] Archived task docs stay as history

## After merge (needs a maintainer)

- [ ] Delete the `EVAL_STORE_TOKEN` repository secret
- [ ] Close #1131 (the PR body says `Fixes #1131`)

## Verify

- [x] `pnpm verify:fast`, `agent:tests` lane, `lint:scripts`, doc-links/doc-index, entropy
- [x] `grep` for leftover `eval/`, `stage-detail`, `capture-collect`, `EVAL_STORE` outside the archive

## Review

- No live code imported the removed set; the only direction was eval → panel.
  Three things broke on deletion and were fixed in place: the `agent:tests`
  lane named `eval/run.test.mjs`, `finding-match.test.mjs` imported
  `eval/finding-record.mjs`, and `checks.test.mjs` read `capture-collect.yml`.
- The `agent:tests` lane is back to one `node --test '**/*.test.mjs'`
  invocation. The `find` + second invocation existed only to isolate
  `eval/run.test.mjs`. The lane guards moved to `scripts/agent/test-lane.test.mjs`
  (coverage at every depth via `path.matchesGlob`, timeout order, no
  force-exit, github-script retries).
- The panel's capture removal is output-neutral: `buildStageDetail` only
  derived and `writeStageDetail` swallowed; nothing read `stage-detail.json`
  or `meta.json` but the collector.
- `lensOf`'s `record.panel.lens` namespace in `finding-match.mjs` is kept; its
  tests now use an inline record fixture. Removing that branch is a separate,
  behavior-changing call.
- `verify:entropy`'s doc-staleness check flags removed file names written as
  code refs in design docs, so history notes name them in prose.
- Verified: agent lane 1780/1780, `lint:scripts`, `verify:doc-links`,
  `verify:doc-index`, `verify:entropy`, `verify:fast`.
