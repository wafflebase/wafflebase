# Lessons — Promote job: close mark-ready's exit-code chain (#937)

## What we learned

- **An exit-code contract is only as good as its default branch.** #929
  pinned all four codes the script emits and still left the consumer open at
  both ends: an unenumerated status (127, 128+signal) fell through to a
  silent success, and node's own crash code (1) was indistinguishable from
  the script's deliberate "a gate said no". Enumerating the codes you emit
  says nothing about the codes you might *receive*.

- **`exit 1` is overloaded by the runtime, so it needs corroboration.** The
  fix does not renumber anything; it requires the script's own verdict line
  on stdout before believing a 1. That turns a comment ("leaving as draft")
  into a cross-file contract, so the test can assert that the string the
  workflow greps for is a literal the script actually prints.

- **`cmd > file; code=$?` — never `cmd | tee file`.** A pipe makes `$?` the
  status of the last element, so the script's code is lost. The test asserts
  the absence of the pipe, because the pipe form is the natural thing to
  reach for when you want the log visible in the step too.

- **A blocked half does not ship as a `.patch` file, and a knowingly-red
  test never ships at all.** The App cannot push workflow files, so the run
  parked the workflow hunk as an unapplied blob under `docs/tasks/active/`
  and left the cross-file test failing "on purpose". Both moves are worse
  than they look: the blob is pinned to blob hashes and line offsets of a
  2400-line file other work edits, nothing verifies it, and the task tooling
  cannot see it; and the red test sits in `verify:self`'s `agent:tests`
  lane, which reds CI on every branch cut from main, which makes
  `mark-ready.mjs`'s gate 1 unsatisfiable — bricking promotion for every
  future PR. **A change that cannot land whole should land as the part that
  is complete on its own** (here: the two mutant-killing tests), with the
  blocked part left in the issue. Deferring to "a maintainer will apply it"
  buys nothing that a smaller PR would not.

- **A permission the agent lacks may be the security model, not a gap.** The
  obvious reading of "the App cannot push workflow files" is that someone
  forgot to grant it, and this task's first draft recommended granting it.
  It is the reverse: `agent-review-panel.yml` picks `workflow_run` precisely
  *because* the App cannot, and `mark-ready.mjs` calls gates 1 and 2
  "unforgeable" for the same reason. Granting it would let an agent branch
  add a workflow named `CI` that passes gate 1 and one with `checks:write`
  that posts its own `agent-review-*` runs for gate 2. **Before proposing to
  widen a permission, grep for what currently depends on its absence** — the
  reason is often written down a few lines from the thing you are editing.

- **A one-run fixture cannot test a sort.** `ciPassed` sorts the SHA's CI
  runs newest-first so a re-run outranks the run it replaced, but every
  fixture in the suite had exactly one CI run — so inverting the comparator,
  or deleting it outright, kept all 14 tests green while a stale green run
  promoted a PR whose current CI was red. A "pick the newest" rule needs at
  least two candidates *and* both orderings, or it is only asserted by
  reading.

- **Assert what a workflow DOES, not how it is typed.** The first pass
  pinned exact echo text and indentation (`0) echo "ready=true" >> …  ;;`)
  inside a fixed 2600-character window only ~700 characters larger than the
  block it bounded. Both fail on a reflow that changes no behavior, and the
  window silently starts reading the *next* step once the block grows.
  Parsing the `case` into its branches and asserting per-branch semantics —
  which codes have a branch, which branches exit and with what, that the
  gates-said-no path does not exit — kills the same eight mutants while
  surviving formatting. Bound a window at the next structural boundary
  (`- name:`), never at a character count.

- **Mutation-test the tests, not just the code.** The two mutants the issue
  named (`name === "CI"` filter, `GH_MUTATION_TOKEN` override) both left
  12/12 green — each is a security-relevant line whose deletion changes no
  observable behavior in the happy-path fixtures. Killing them needed
  fixtures that are *only* distinguishable by that line: a same-SHA non-CI
  workflow run that concluded `success`, and a `gh` stub that fails unless it
  sees the App token.
