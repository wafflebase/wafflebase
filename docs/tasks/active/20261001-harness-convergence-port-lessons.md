# Lessons — porting the review-loop convergence work

## A port is a re-derivation where the repos differ

**Check where the source puts its code before copying where it puts it.**
js-sdk's infra page and removal record live in its trusted `fix-report` job,
justified by a rule in its `checks.test.mjs`: nothing runs after the agent in
the agent's own job. wafflebase has no such job and no such test, and its `fix`
job runs half a dozen reporting steps after the agent. Copying the steps into
that job would have matched the local shape and broken the source's reason for
the shape. A small new job (`fix-evidence`) keeps the reason without
restructuring everything else, and the gap is recorded as a follow-up rather
than silently inherited.

**Re-decide a failure policy when the job it keys on does less.** js-sdk pages
from `stalled` when `fix-report` fails, because that job owns the no-commit page
and the fix report. The ported job owns evidence and one page. Copying the
condition would let a checkout hiccup latch a PR that had pushed a good fix.

**Reuse the local original, narrowed, instead of the source's copy of it.**
js-sdk's probe classifier was itself copied from wafflebase's `auth-smoke.mjs`
and then narrowed (a transient 429 must not latch a PR). Porting the narrowed
copy back would have left two lists that already disagreed. One vocabulary with
two thresholds (`classifyFailure` for a pre-arm check, `classifyRefusal` for a
latch) keeps them from drifting, and a test pins where they agree and differ.

## The local gates found what a straight port could not

**`eval/panel-identity.test.mjs` caught a new module entering the panel.**
`test-removals.mjs` is imported by `fix-report.mjs` and `rebuttal.mjs`, so it
changes what the adjudicator reads. js-sdk has no panel digest, so nothing there
flagged it. Classifying it as panel code (and bumping the digest version, as the
module's own rule says) was the right answer; a reason in `NOT_PANEL_FILES`
would have been false.

**Test-file patterns are per-repo facts, and a wrong pattern fails silent.**
js-sdk's `[._](test|spec)` misses `*.e2e-spec.ts` (`-spec`) and
`*.integration.ts`. Both live under a `test/` or `tests/` directory, so a
deletion is still seen, but a rename out of the runner's pattern
(`x.e2e-spec.ts` → `x.e2e-spec.ts.off`) would have been reported as a harmless
move. Read the runner configs (`jest-e2e.json` `testRegex`, the backend's
`jest.testRegex`, `test:integration`) before trusting the regex.

**Prompt rules name the API of the runner the agent will be in.** `it.fails` is
Vitest's. The backend runs Jest, where the same idea is `test.failing`; telling
a fixer in `packages/backend` to use `it.fails` would get a test that does not
run, which the detector would then (rightly) count as removed.

**A focus is a removal under Jest.** Vitest refuses `.only` in CI; Jest does
not, and this repo has no lint rule for it. A detector written for one runner
counted `it.only` as an active case — true, and beside the point: every sibling
stopped. Ask what each runner does with each spelling, not whether it "runs".

**Clamp once, after summing.** Per-commit clamping turned a suite skipped and
re-enabled inside one round into a reported disablement. Sum the raw counters
over the unit you report on, then clamp.

**The race is with the next run's startup, not with CI.** The panel starts on
CI's `requested` event, so the window for the removal record is the next run's
gate, `deps` and checkout (1–3 minutes), and a record that misses it is never
read. Describe a race by the two events that bound it.

## Process

- Measure byte-identity before porting. Three files were identical and took the
  patch unchanged; keeping them identical (including js-sdk's `#1426`) makes the
  next sync a diff.
- Split a commit by intent even when the workflow file is shared: the removal
  step was held out of the probe/infra commit and restored in the evidence
  commit, so each commit's tests pass on their own.
- The pre-commit hook runs the whole `pnpm verify:fast`, which never reaches
  `scripts/agent` (it is outside the pnpm workspace). For a harness-only change
  the real gates are the `scripts/agent` suite, `lint:scripts` and the doc gates;
  run them by hand and say so.
- A byte-identical port inherits the source repo's blind spots, not the
  target's guards. `fingerprint.test.mjs` came from js-sdk without
  `fixtureGitEnv`. The first `git push` ran it under the pre-push hook with
  `GIT_DIR` exported. It set `core.bare` and a `t@t` identity in the shared
  submodule config, broke the submodule checkout, and committed over this
  branch. The push failed, so nothing reached the remote. `git-env.test.mjs`
  now fails on any test that spawns git and runs `init` without importing
  `git-env.mjs`. Before porting a test, check it against the target's own
  helpers.
