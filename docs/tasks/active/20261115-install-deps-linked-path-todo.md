# install-deps: run when started through a linked path

Issue: #1151

## Problem

`scripts/agent/install-deps.mjs` decides whether it was run directly by
comparing `path.resolve(process.argv[1])` with `fileURLToPath(import.meta.url)`.
`path.resolve` does not follow symbolic links while Node resolves the module's
own URL to its real path, so a run through a linked path (a runner whose work
directory passes through a link) compares unequal: the process exits 0 having
neither installed nor refused, and the caller sees a green step with no install.

## Plan

- [x] Replace the entry check with an `isDirectRun()` that realpaths both
      sides, returning false when `argv[1]` cannot be resolved.
- [x] Add a test to `scripts/agent/install-deps.test.mjs` that runs the script
      through a symlinked directory with no workspace and asserts it exits 1
      with the `::error::install-deps:` refusal, not 0 in silence.
- [x] Nothing else in the script changes.

Round 2 of review widened it, because the premise is not install-deps':

- [x] Move the answer into one module (`scripts/agent/direct-run.mjs`) and wire
      every tool in that directory to it — all 25 are launched by the same
      workflows from the same staged `$RUNNER_TEMP/agent-tools` copy, so the
      silent `exit 0` was theirs too (`pick-credential.mjs` with the weaker
      `file://${argv[1]}` form on top).
- [x] Make an unresolvable entry path **throw** rather than answer "imported",
      and have `install-deps.mjs` refuse loudly on it: `catch { return false }`
      was the same silent no-op the fix exists to remove.
- [x] Pin it: `direct-run.test.mjs` runs a script through a linked directory,
      covers the throw and the refusal, and fails if any tool in the directory
      hand-rolls the comparison again.

## Notes

The same fix already exists in the toolchain-action copy on the open adoption
PR (#1150); this is the copy on `main` until that switch replaces it.
