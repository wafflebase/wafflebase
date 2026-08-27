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

- **Tightening a read gate breaks the write that was sized for the loose
  one.** Making gate 1 mean "EVERY CI run for the SHA is green" is strictly
  fail-closed on the read side — but `@claude rerun` / `@claude loop` had
  been re-running the *newest* run only (`per_page: 1`), which was exactly
  enough under "newest wins" and cannot clear the new rule at all: an older
  red run for the same SHA stays red, so the verbs re-run CI, the panel
  reviews again, and promote refuses forever while the comment says the panel
  "can promote or fix this PR". When you narrow what counts as passing, grep
  for whoever was trying to *make* it pass.

  The repair lives in two workflow files, which the App cannot push — so the
  autonomous run landed the rule (`ciRunsToRerun` + its test) and left the two
  mirrors to a maintainer, exactly as the two lessons above prescribe: no
  parked `.patch` blob, and no cross-file assertion that is red until someone
  applies it. **Check who can push the files a finding's fix lives in before
  you write it**, not after the push is rejected. A maintainer then wired both
  mirrors, and `checks.test.mjs` pins them against the exported rule.

- **Fixing a hole that is not open is not free, and the bill arrives as more
  findings.** Gate 1 read the newest CI run. A lens argued that fails open once
  a SHA carries two runs, so the rule became "EVERY run must be green". The
  premise was checked and was already false — `ci.yml`'s `push` is `main`-only
  and a `merge_group` run carries the speculative merge commit, so a PR head
  has exactly one run — and the change was made anyway, to "not depend on
  that". It then produced three real defects across two review rounds:
  `@claude rerun` could no longer clear the gate (it re-ran one run); re-running
  all of them eroded `agent-iterate-ci`'s attempt bound, which counts current
  `failure` conclusions while a re-run REPLACES one; and the fan-out emitted a
  `workflow_run` completion per run into a `cancel-in-progress` group,
  cancelling the fixer mid-push.

  The resolution was to revert to newest-wins and spend the effort on a
  **tripwire for the invariant instead** — a test asserting `ci.yml`'s trigger
  set still yields one run per PR head. It is three lines, it fails loudly the
  day someone widens `push`, and it costs nothing in between. **When a finding's
  premise is not reachable today, harden the thing that keeps it unreachable,
  not the code downstream of it.**

- **Tolerance added for a shape the system does not have is an attack
  surface.** The path match stripped an `@ref` suffix because *called*
  workflows report one — a form CI is not invoked in. That tolerance made
  "ci.yml" + at-sign + anything-ending-in-.yml match the real workflow, which
  is a legal filename Actions will run, re-opening the very forgery the check
  had just closed. It is the second time on this branch that hardening for an
  unreachable case created a reachable defect (the first was requiring every
  CI run green). **A defensive branch for a case that cannot occur is not
  free: it is untested code on the trusted path.** If the shape ever appears,
  the strict version fails closed and says so.

- **Do not decide identity by parsing a string you did not issue.** The whole
  `@`-suffix class disappeared by asking the API for the CI workflow's runs
  (`/actions/workflows/ci.yml/runs`) instead of fetching every run and matching
  `path` in JS. GitHub resolves the file; a filename cannot spoof it. It also
  removed a second finding for free — a flood of unrelated runs could no longer
  push the CI run past `per_page`, because only CI's runs come back. When a
  service can scope a query for you, that is the identity check; re-deriving it
  client-side is how the bug got in.

- **A comment that overclaims is a defect, and this branch shipped three.**
  The header said EVERY run must be green after the rule was reverted to
  newest-wins; it called gates 1-2 UNFORGEABLE when a `pull_request` run
  executes the PR branch's own `ci.yml`, so a branch that can edit that file
  gets a genuinely green run at the genuine path; and a new test claimed
  "exactly one CI run per PR head SHA" when reopening a PR files a second one.
  The whole branch exists because a gate claimed a property it did not have —
  and then reproduced the mistake three times while fixing it. **After changing
  a rule, re-read every sentence that describes it**, including the ones you
  wrote in the same session.

- **Three rounds of "my fix caused the next finding" is a signal to look
  upstream, not to keep patching.** Rounds 4, 5 and 6 each opened with a defect
  introduced by the previous round's fix. Each individual fix was correct for
  the finding in front of it; the chain was still wrong, because all of it hung
  off one avoidable decision. Reverting that decision deleted the whole subtree
  — three findings, two workflow edits and a helper — in one commit. Count how
  many consecutive rounds trace back to a single change of yours; at two, stop
  and re-examine that change rather than its consequences.

- **Two actors can fix one finding at once, and the merge is not "pick a
  side".** The autonomous fixer and a maintainer session both answered this
  finding within minutes, and the push collision is how anyone found out. The
  maintainer's version wired the two call sites (which only a maintainer can);
  the agent's version had the better *rule* — it skipped in-flight runs, which
  the API refuses to re-run with a 422, and it kept re-running exactly one run
  when they are all already green, without which the verb turns into a no-op
  and the panel never re-engages. Both of those were bugs in the maintainer's
  copy. **Read the other version before resolving**, and take the union: the
  agent's rule, the maintainer's wiring, and a test tying the copies together.
  Force-pushing over `claude[bot]` would have silently reintroduced both.

- **A security example that names a file that must never exist still trips the
  doc-staleness gate.** Documenting the forged path as a single backticked
  token, `ci.yml` + `@` + an attacker's own `.yml`, is exactly the shape
  `extractFileRefs` reads as a file reference (its character class admits `@`),
  so `verify:entropy` reported it as broken and failed the lane. The fix is to
  spell such a name out in prose, not to add a `docStaleness.advisory` entry:
  that list means "this file is planned and will exist", and a forgery example
  is the opposite claim. Suppressing it would also have downgraded a real
  reference later if the name were ever reused.
