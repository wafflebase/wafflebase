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

- [ ] Replace the `if` chain with a `case` that has a `*)` default which
      fails the job (exit 2).
- [ ] Capture the script's output to `$RUNNER_TEMP/mark-ready.log` with a
      **redirect, not a pipe**, so `$?` is the script's own status; `cat` it
      back so the log still appears in the step.
- [ ] Make the code-1 branch require the script's own verdict line
      (`Not promoting: one or more gates are not satisfied`) on stdout — a
      bare exit 1 with no verdict is a crash, so exit 2 and page.
- [ ] Update `mark-ready.test.mjs`'s four `-eq N` workflow assertions to the
      `case` form, plus anchored checks for the `-eq 1` branch body, the
      `--promote` flag, the non-pipe redirect and the `*)` default.
- [ ] Pin the verdict string as a **cross-file contract**: the workflow's
      `grep -qF` needle must be a literal the script actually prints.
- [ ] Harden the exit-code census so a non-literal `process.exit(c)` fails
      instead of surviving.
- [ ] Kill the two surviving mutants #929's suite left green:
      - deleting the `name === "CI"` workflow-run filter (`mark-ready.mjs`),
      - removing `ghMutate`'s `GH_MUTATION_TOKEN` env override.

## Non-goals

- No change to `mark-ready.mjs`'s behavior or its exit-code numbering. The
  script's contract is already what #929 pinned; only the consumer and the
  tests change.
- No new paging channel. Exit 2 already reds the job, which the `stalled`
  safety net covers.

## Blocker: this branch cannot carry the workflow file

The workflow half of this change is written, verified, and **not on this
branch**. It lives in
`20260825-promote-exit-code-default-workflow.patch` next to this file.

The autonomous run authenticates as the `yorkie-agent[bot]` GitHub App, and
that installation is not granted GitHub's `workflows` permission, so the push
is refused at the server:

```
! [remote rejected] agent/937-promote-exit-code-default (refusing to allow a
  GitHub App to create or update workflow `.github/workflows/agent-review-panel.yml`
  without `workflows` permission)
```

There is no `workflows:` key in a job's `permissions:` block — the scope
exists only on a GitHub App installation or a PAT — so `agent-implement.yml`
cannot grant it to itself. **Every** harness change that touches a workflow
file hits this, not just this issue.

To land it, a maintainer (or a credential with `Workflows: write`) runs:

```sh
git apply docs/tasks/active/20260825-promote-exit-code-default-workflow.patch
git rm docs/tasks/active/20260825-promote-exit-code-default-workflow.patch
```

Until that hunk lands, `mark-ready.test.mjs`'s
`agent-review-panel.yml handles every mark-ready code, defaults the rest`
**fails on purpose** — it is the cross-file contract reporting that the
consumer half is missing. The other 13 tests pass.

## Verification

- `node --test scripts/agent/mark-ready.test.mjs` — 14/14 with the patch
  applied, 13/14 without it (the workflow-shape test, as above).
- The `case` block was extracted and simulated against stub scripts for all
  six statuses — 0, 1-with-verdict, 1-as-crash (bad import), 2, 3, and a
  missing script — and produced job rc 0 / 0 / 2 / 2 / 3 / 2 with
  `ready=true` emitted only for 0.
- Five mutants, each killed by exactly one test: dropping the `name === "CI"`
  filter, dropping `ghMutate`'s `GH_MUTATION_TOKEN` override, reverting the
  workflow to the old `if` chain, dropping `--promote` from the invocation,
  and changing the `grep -qF` needle to a string mark-ready never prints.
- CI (`verify:self`) on the PR.
