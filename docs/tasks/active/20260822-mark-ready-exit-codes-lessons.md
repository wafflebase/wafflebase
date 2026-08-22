# Lessons: pinning mark-ready.mjs's exit codes (#852)

## An import-time CLI is testable as a process, not as a module

`mark-ready.mjs` calls `process.exit` at top level, which is why its two
shareable constants already live in `checks.mjs` and `disclosure.mjs`. That
constraint pushed the test to `spawnSync("node", [CLI, …])` with a stub `gh`
first on `PATH` — no refactor of the script, and the thing under test is the
exact artifact the workflow runs, exit code included.

## The stub log is half the value

Asserting the exit code alone would pass for a script that exited 0 without
promoting anything. Logging every `gh` argv lets the same fixture also assert
the *effects*: a dry run must not call `pr ready`, a promotion must, and an
already-ready PR must not re-promote. The exit code and the mutation are two
independent halves of "code 0 means promoted".

## Pin the consumer, not just the producer

The failure the issue describes is a *mismatch* between the script and the
workflow that branches on it, so a test that only reads the script would still
go green after a renumber on either side. Reading the real
`agent-review-panel.yml` and asserting its `-eq 2` / `-eq 3` / `-eq 1` /
`-eq 0` branches is what closes that.

## `1` vs `0` is the whole point

Both let the job succeed, which is exactly why nothing noticed the mapping was
unpinned. The gate-failure test asserts `1` *and* that the process printed the
"Not promoting" line — so collapsing it into 0 cannot pass by accident.
