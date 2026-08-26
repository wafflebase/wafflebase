# Promote job: close mark-ready's exit-code chain (#937)

Follow-up to #852 / PR #929, which pinned `mark-ready.mjs`'s exit-code
contract but deliberately changed no behavior. This is the behavior half.

## Problem

`.github/workflows/agent-review-panel.yml`'s `promote` job branches on
`mark-ready.mjs`'s status with four bare `if [ "$code" -eq N ]` tests and
no `else`:

1. **Any status outside `{0,1,2,3}`** — `127` from a missing binary, a
   `128+signal` — falls through every branch and the step exits 0 with no
   output at all.
2. **Node's own crash code is 1.** A `SyntaxError`, a failed import of
   `./checks.mjs` / `./set-state.mjs` / `./disclosure.mjs`, or an unhandled
   rejection is reported as the benign "Not all ready-gates satisfied;
   leaving as draft", the job succeeds, nothing re-runs the panel, and a PR
   that should have been promoted sits as a draft forever.

#929's suite cannot see either: its `{0,1,2,3}` census matches only literal
`process.exit(<digits>)`, and its workflow assertions are windowed regexes
that stay green if the `-eq 1` branch is given an `exit 1` or if `--promote`
is dropped from the invocation.

## Plan

- [x] Replace the `if` chain with a `case` that has a `*)` default which
      fails the job (exit 2).
- [x] Capture the script's output to `$RUNNER_TEMP/mark-ready.log` with a
      **redirect, not a pipe**, so `$?` is the script's own status; `cat` it
      back so the log still appears in the step.
- [x] Make the code-1 branch require the script's own verdict line
      (`Not promoting: one or more gates are not satisfied`) on stdout — a
      bare exit 1 with no verdict is a crash, so exit 2 and page.
- [x] Update `mark-ready.test.mjs`'s four `-eq N` workflow assertions to the
      `case` form, plus checks for the `1)` branch body, the `--promote` flag,
      the non-pipe redirect and the `*)` default.
- [x] Pin the verdict string as a **cross-file contract**: the workflow's
      `grep -qF` needle must be a literal the script actually prints.
- [x] Harden the exit-code census so a non-literal `process.exit(c)` fails
      instead of surviving.
- [x] Kill the two surviving mutants #929's suite left green:
      - deleting the CI workflow-run filter (`mark-ready.mjs`),
      - removing `ghMutate`'s `GH_MUTATION_TOKEN` env override.

## Scope added after review (panel rounds 2–6)

The branch's Non-Goal said "no change to `mark-ready.mjs`'s behavior". Pinning
the gate with tests exposed two defects in what was being pinned, and the panel
raised both as blocking across consecutive rounds — a gate whose own header
calls itself UNFORGEABLE while not being so is worse than one that never
claimed it.

- [x] **Identify CI by workflow PATH, not by the run's display name.** `name` is
      only a file's `name:` key; a second file claiming `name: CI` produced
      indistinguishable runs. `CI_WORKFLOW_PATH` + `ciConclusion()` in
      `checks.mjs` are now the single source for both readers
      (`mark-ready.mjs`, `set-state.mjs`).
- [x] **Keep newest-wins, and pin the invariant that makes it safe.** A brief
      revision required EVERY run for the SHA to be green; it closed nothing
      reachable and cost three defects (see the lessons file). Reverted, with a
      test asserting `ci.yml`'s triggers still yield one CI run per PR head
      SHA, and ordering moved from `created_at` to run `id` so an absent or
      unparseable timestamp cannot reorder anything.
- [x] **Guard the TRIGGER side too.** `workflow_run`'s `workflows:` filter can
      only match a display name, so `agent-review-panel.yml`,
      `agent-iterate-ci.yml` and `ci-report.yml` assert
      `github.event.workflow_run.path` in their gating job. Without it a forged
      `name: CI` run still drove the arms that push commits with
      `contents: write`. `docker-publish.yml` / `publish-ghpage.yml` need no
      clause: their `head_branch == 'main'` gate means a forgery would have to be
      merged first.
- [x] **Record the promote job's `outcome`** so the loop-status comment names
      what happened instead of guessing from the absence of `ready`.

## Non-goals

- No change to `mark-ready.mjs`'s behavior or its exit-code numbering. The
  script's contract is already what #929 pinned; only the consumer and the
  tests change.
- No new paging channel. Exit 2 already reds the job, which the `stalled`
  safety net covers.

## How the workflow half got here

The autonomous run authenticates as the `yorkie-agent[bot]` GitHub App, and
that installation is not granted GitHub's `workflows` permission, so its push
was refused at the server:

```
! [remote rejected] agent/937-promote-exit-code-default (refusing to allow a
  GitHub App to create or update workflow `.github/workflows/agent-review-panel.yml`
  without `workflows` permission)
```

There is no `workflows:` key in a job's `permissions:` block — the scope
exists only on a GitHub App installation or a PAT — so `agent-implement.yml`
cannot grant it to itself. **Every** harness change that touches a workflow
file hits this, not just this issue.

The run's workaround was to park the hunk as an unapplied
`…-workflow.patch` next to this file and leave the cross-file test red on
purpose. That is not a landable shape: the suite runs in `verify:self`'s
`agent:tests` lane, a red `verify:self` reds CI on every branch cut from
main, and `mark-ready.mjs`'s gate 1 requires a green CI run — so merging it
would have made **no** agent PR promotable again, the permanent version of
the stall this change exists to prevent. The same anti-pattern is already on
record as a panel finding in `scripts/agent/rounds.test.mjs`.

A maintainer applied the hunk to the real workflow and deleted the `.patch`
file, so both halves land together and the suite is green.

**The App must NOT be granted `Workflows: write` to fix this.** That was this
doc's first recommendation and it is wrong: the missing permission is not an
oversight, it is the load-bearing part of the loop's trust model. Both
"unforgeable" ready gates rest on it —

- `agent-review-panel.yml` uses `workflow_run` *because* it always executes
  the default-branch definition, and says so in as many words: "The agent App
  cannot push `.github/workflows/**` … Do not swap this trigger for `push` or
  `pull_request`."
- `mark-ready.mjs`'s header calls gates 1 and 2 UNFORGEABLE because "the
  author agent cannot create or forge a CI run" and only the reviewer
  workflow holds `checks:write`.

Grant the App workflow-write and an agent branch can add a `push`-triggered
workflow named `CI` that concludes `success` on its own head SHA (gate 1,
which matches on the run's display name), and another with
`permissions: checks: write` posting its own `agent-review-*` check runs
(gate 2). Both gates then read green on evidence the author produced.

The right follow-up is the opposite: make "the agent does not edit workflow
files" an explicit policy that the implement step checks **before** it starts
writing one, so the run hands off with the hunk in the issue instead of
inventing a `.patch` blob after the push is refused.

## Verification

- `node --test scripts/agent/*.test.mjs` — 1736 pass / 0 fail;
  `node --test scripts/test/*.test.mjs` — 225 / 0.
- The `case` block was extracted and simulated against stub scripts for all
  six statuses — 0, 1-with-verdict, 1-as-crash (bad import), 2, 3, and a
  missing script — and produced job rc 0 / 0 / 2 / 2 / 3 / 2 with
  `ready=true` emitted only for 0.
- Thirty-two mutants across the branch, each killed:
  - **the consumer** — the old `if` chain; a dropped `--promote`; a `grep -qF`
    needle mark-ready never prints; a deleted `*)` default; a `| tee` pipe in
    place of the redirect; a `1)` branch that exits; a gate branch that records
    no `outcome`; a loop-status label typo; a loop-status without a default arm;
  - **gate 1** — display-name matching; a dropped `@ref` tolerance; an inverted
    newest-by-id; a dropped in-flight guard; a `CI_WORKFLOW_PATH` typo; a
    dropped `name === "CI"` filter; a dropped `GH_MUTATION_TOKEN` override; a
    non-literal `process.exit`;
  - **the triggers** — a dropped `path` guard on the gate; the same clause
    dropped from the concurrency group (which would have let a forged run
    cancel a live panel);
  - **the invariant** — widening `ci.yml`'s `push` to every branch, which is
    what newest-wins depends on; a re-run that fans out again; a re-run that
    ignores `status: completed`.
- CI (`verify:self`) on the PR.
