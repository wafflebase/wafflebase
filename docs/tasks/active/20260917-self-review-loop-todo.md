# Self-review loop before the PR

A hand-driven PR gets **no automated review**. Measured on this repository:
`#1071`, `#1063`, `#1057` (all human branches, no label) carry only
`verify-self` / `verify-browser` / `verify-integration` /
`verify-backend-image` / codecov. Zero `agent-review-*` check runs.

The gate is `agent-review-panel.yml:192-199` (mirrored in
`agent-iterate-ci.yml:80`):

```js
let managed = branch.startsWith('agent/');
if ((pr.labels||[]).some(l => (l.name||l) === 'agent:managed')) managed = true;
```

`#1061` is the proof it is opt-in and not branch-shaped: a human branch
(`feat/member-api-keys`) that carried `agent:managed` got all seven lens checks.

So the workflow's step 3 ("Self review") is the only review a normal PR gets
before a human opens it — and today it is one prose line describing a single
pass with no exit condition and no record.

## Goal

Turn step 3 into a **bounded loop** and make the local panel actually support
rounds.

## Plan

### 1. Documentation — the bounded loop

- [x] `CLAUDE.md` § Task Workflow step 3 → review → fix → `verify:fast` →
      re-review, **max 3 rounds, exit early on a round with no blocking
      findings**, lens rotated per round, each round logged in `*-lessons.md`.
- [x] `CONTRIBUTING.md` PR workflow step 3 → the same, in contributor voice.
- [x] Both must name the three ways a locally-authored PR can reach the panel
      (pre-PR local run, `@claude review`, `@claude loop`) so the opt-in is not
      folklore.

### 2. `spec-to-pr.mjs review` — round threading

`cmdReview()` passes only `--diff-file / --changed-files / --base-sha /
--lenses-dir / --out`. The panel's round inputs exist and are unused locally:

- `--prior-findings` — carries the previous round's **unfixed blocking**
  findings so this round's fresh pass missing one cannot silently clear it
  (the #521 false negative).
- `--rebuttals` — the author's structured "this finding is wrong" claims,
  adjudicated by a fresh subagent. Without it a finding you deliberately
  declined is re-raised identically every round.

Both are read from PR comments in the cloud (`prior-findings.mjs`,
`rebuttal.mjs read <pr>`), which is why neither is reachable before a PR exists.

- [x] Stable per-branch output directory instead of `mkdtempSync` (today the
      panel's output is written to a random temp dir the command never prints).
- [x] Auto-incrementing `--round`, with `--fresh` to start over.
- [x] Round > 1 builds `prior-findings.json` from the previous round's
      `<lens>/verdict.json`, filtered to gating blocking findings.
- [x] `--rebuttals <file>` passthrough.
- [x] Print each blocking finding (lens, `file:line`, summary, `findingKey`) and
      the output directory. Today it prints lens ids and nothing else.
- [x] Unit tests in `scripts/agent/spec-to-pr.test.mjs` for the pure helpers.

### 3. `/self-review` slash command

The review lives inside `spec-to-pr.mjs`, whose name says "agent track". That is
the whole reason the capability reads as unavailable to hand-driven work.

- [x] `.claude/commands/self-review.md` — drives the bounded loop from any
      branch, no handoff, no `agent/` prefix, no cloud ownership.

### 4. Design doc

- [x] `docs/design/agentic-dev-loop.md` § 1 — a `Self review` row, and a line
      saying a plain PR is reviewed by nobody unless someone opts it in.

## Verification

- [x] `pnpm verify:fast` green per commit (the pre-commit hook runs it; six
      commits, six green runs).
- [x] `--dry-run` round 1 → round 2 with a seeded round-1 verdict: reports
      `round 2`, carries exactly the 2 gating findings and drops the `minor` and
      the `lane: backlog` ones.
- [x] `--fresh` resets to round 1; `--round 4` prints the bound advisory and
      still runs; `--round zero` and a valueless `--round` both exit 1.
- [ ] **Not done: a real panel round.** `CLAUDE_CODE_OAUTH_TOKEN` is not
      exported in this environment, so the panel skips with its warning. The
      round threading, the carry-forward and the reporting are exercised by unit
      tests and by `--dry-run`; what has NOT been run end-to-end is the panel
      itself writing `verdict.json` files that the next round then reads back.
      Run `node ./scripts/agent/spec-to-pr.mjs review` twice on a branch with a
      real finding to close this.

## Review

Six commits. The three planned pieces landed, plus a fourth that the first
review round turned up.

1. `carryForwardFindings` in `prior-findings.mjs` — the selection half of the
   projection `agent-review-panel.yml` applies inline, stated once, with a
   drift-guard test asserting the workflow's copy still applies both filters
   (the `rounds.test.mjs` `PAGED_LATCH` pattern). The workflow's field trimming
   is deliberately not mirrored: it is transport for a 60k check-run budget.
2. `spec-to-pr.mjs review` — rounds as directories under a per-branch base,
   auto-incrementing, `--fresh` to reset. Carry-forward is per lens (mirroring
   `collectPrior`), not "the previous round" wholesale, so a lens that crashed
   in round 2 still carries its round-1 findings. `--rebuttals` passthrough.
   Blocking findings now print with location, summary and `findingKey`.
3. `/self-review` + the two workflow docs + `agentic-dev-loop.md` § 1.1.
4. Three defects found reviewing (1)–(3): a crash on a junk report entry, a
   valueless `--round` silently overwriting round 1, and a blocking lens with
   no printable finding rendering as silence — which is exactly the
   "the lens never ran" case that must not read as "found nothing".

**Known limitations.**

- The panel round was not run for real (see Verification).
- `--review-mode incremental` is not wired. Deliberate: the decision belongs to
  `review-scope.mjs` reading a PR's history, which does not exist pre-PR.
- A detached HEAD shares one round directory (the branch name is `HEAD`).
- The round state lives in `os.tmpdir()`, so it does not survive a reboot. That
  is the intended lifetime — an abandoned branch cleans itself up — but a loop
  spanning days will silently restart at round 1.
