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

- [ ] `CLAUDE.md` § Task Workflow step 3 → review → fix → `verify:fast` →
      re-review, **max 3 rounds, exit early on a round with no blocking
      findings**, lens rotated per round, each round logged in `*-lessons.md`.
- [ ] `CONTRIBUTING.md` PR workflow step 3 → the same, in contributor voice.
- [ ] Both must name the three ways a locally-authored PR can reach the panel
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

- [ ] Stable per-branch output directory instead of `mkdtempSync` (today the
      panel's output is written to a random temp dir the command never prints).
- [ ] Auto-incrementing `--round`, with `--fresh` to start over.
- [ ] Round > 1 builds `prior-findings.json` from the previous round's
      `<lens>/verdict.json`, filtered to gating blocking findings.
- [ ] `--rebuttals <file>` passthrough.
- [ ] Print each blocking finding (lens, `file:line`, summary, `findingKey`) and
      the output directory. Today it prints lens ids and nothing else.
- [ ] Unit tests in `scripts/agent/spec-to-pr.test.mjs` for the pure helpers.

### 3. `/self-review` slash command

The review lives inside `spec-to-pr.mjs`, whose name says "agent track". That is
the whole reason the capability reads as unavailable to hand-driven work.

- [ ] `.claude/commands/self-review.md` — drives the bounded loop from any
      branch, no handoff, no `agent/` prefix, no cloud ownership.

### 4. Design doc

- [ ] `docs/design/agentic-dev-loop.md` § 1 — a `Self review` row, and a line
      saying a plain PR is reviewed by nobody unless someone opts it in.

## Verification

- [ ] `pnpm verify:fast` green per commit.
- [ ] `node ./scripts/agent/spec-to-pr.mjs review --dry-run` on this branch
      prints the round it would run and the directory it would write.
- [ ] A real round against this branch's own diff (needs
      `CLAUDE_CODE_OAUTH_TOKEN` and `cd scripts/agent && npm ci`).

## Review

(filled in at the end)
