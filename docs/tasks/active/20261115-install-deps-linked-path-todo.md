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

- [ ] Replace the entry check with an `isDirectRun()` that realpaths both
      sides, returning false when `argv[1]` cannot be resolved.
- [ ] Add a test to `scripts/agent/install-deps.test.mjs` that runs the script
      through a symlinked directory with no workspace and asserts it exits 1
      with the `::error::install-deps:` refusal, not 0 in silence.
- [ ] Nothing else in the script changes.

## Notes

The same fix already exists in the toolchain-action copy on the open adoption
PR (#1150); this is the copy on `main` until that switch replaces it.
