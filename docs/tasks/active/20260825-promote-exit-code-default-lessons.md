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

- **Mutation-test the tests, not just the code.** The two mutants the issue
  named (`name === "CI"` filter, `GH_MUTATION_TOKEN` override) both left
  12/12 green — each is a security-relevant line whose deletion changes no
  observable behavior in the happy-path fixtures. Killing them needed
  fixtures that are *only* distinguishable by that line: a same-SHA non-CI
  workflow run that concluded `success`, and a `gh` stub that fails unless it
  sees the App token.
