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
- [x] **Three real panel rounds ran** against this branch's own diff, on the
      machine's logged-in Claude Code session. The carry-forward is no longer
      theoretical: round 2 reported `carrying 7 prior finding(s) forward` and
      round 3 `carrying 5`.

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

### The loop, run on itself

The branch was reviewed by the thing it adds. Three rounds, then the bound.

| Round | Reviewer | Lenses blocking | Findings | Carried in |
| --- | --- | --- | --- | --- |
| 0 | me, reading my own diff (no token, panel skipped) | — | 3 | — |
| 1 | the panel | 5 of 6 | 7 (2 critical) | — |
| 2 | the panel | 5 of 6 | 5 | 7 |
| — | the panel | 6 of 6 **infra** | 0 — HTTP 429, usage limit | 5 |
| 3 | the panel | 3 of 6 | 5 | 5 |
| 4 | the panel | 3 of 6 | 7 (1 critical) | 5 |

Round 0 found three surface defects. It did not find the two criticals — a
`--fresh` that deleted any `--out` path, and a prompt-injection channel into the
next round's verifier — because a reviewer sharing the author's context inherits
the author's blind spots. That is the argument for this feature, made against it.

Round 2 found a hole in round 1's own fix (`roundsOnDisk` counted a *skipped* or
*crashed* lens as having reviewed, so the per-lens carry-forward silently
dropped findings — the exact failure its docblock claimed to prevent), and round
3 found one in round 2's (`--out` reduced the new path-chain check to the
leaf-only check it replaced). Each round's fix was itself reviewed.

Two findings were about this repository rather than this branch: `/spec-to-pr`'s
and CLAUDE.md's descriptions of the tool had gone stale within the same branch.

Round 4 ran past the documented bound, at the developer's request, and earned
its place: it found a **critical that round 3's own fix had introduced**. Round
3 had replaced a leaf-only directory check with "every level we created", which
skips an ancestor precisely when it already exists — the case an attacker
supplies. The guard has now been wrong in four consecutive shapes:

| Round | The guard | What was wrong with it |
| --- | --- | --- |
| — | `mkdtempSync` (0700, random) | nothing; the stable path traded it away |
| 1 | predictable path, default umask | prompt-injection channel into the next round's verifier |
| 2 | leaf checked 0700 | the intermediate directory was never inspected |
| 3 | "every level we created" | a pre-created or symlinked ancestor is skipped |
| 4 | every level below `os.tmpdir()`, whoever made it | — |

**Nothing was rebutted.** Every finding across four rounds was accepted and
fixed, so a real adjudication has still never run. The `--rebuttals` path is
covered by unit and CLI tests only.

**Cost.** Five panel invocations, one of which reviewed nothing (429). The usage
limit is the practical bound on running this locally, well before the
three-round one — and until `28e49883b`, a 429 also consumed a round number, so
an outage could push a branch into the bound on its own.

### Known limitations

- **Round 4's fixes have not been reviewed.** That is the standing state of any
  loop that stops: the last round's repairs are the unreviewed ones. It matters
  more than usual here because they include the fourth rewrite of the directory
  guard, in the one area that has not converged. Round 5 is what would check it;
  the rule this branch adds says to get a human or `@claude review` — which
  spends the repository's pooled credential rather than a developer's, and does
  not inherit the local rounds' context — instead of looping a fifth time.
- **Nothing found after round 4 was reviewed either**, including the corrected
  finding key and `prepareRoundInputs`.
- `--rebuttals` is normalized, refused when unusable, and argv-asserted, but has
  never been exercised against a real adjudication — no finding in four rounds
  was worth disputing.
- The printed finding key was the wrong module's for three rounds
  (`finding-key.mjs`'s instead of `rebuttal.mjs`'s) while the docs asserted it
  was the right one. No lens caught it; it surfaced from a direct reading of
  both modules. **Cross-module claims in prose are not covered by this loop.**
- `--review-mode incremental` is not wired. Deliberate: the decision belongs to
  `review-scope.mjs` reading a PR's history, which does not exist pre-PR.
- A base directory a developer created by hand at the default umask is refused
  (0700 is required). The message says why, but it is a papercut for anyone
  passing `--out` at a path they made themselves.
- A detached HEAD shares one round directory (the branch name is `HEAD`).
- The round state lives in `os.tmpdir()`, so it does not survive a reboot. That
  is the intended lifetime — an abandoned branch cleans itself up — but a loop
  spanning days will silently restart at round 1.
