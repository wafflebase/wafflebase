# CLI: `--quiet` must preserve the result body and the error envelope

Issue: [#660](https://github.com/wafflebase/wafflebase/issues/660)

## Problem

`--quiet` currently suppresses *everything*, not just progress notices:

- `wafflebase schema --quiet` exits 0 with 0 bytes on stdout — the body
  is discarded, so `... --quiet > out.json` silently writes an empty file.
- A failing command under `--quiet` exits non-zero with 0 bytes on both
  stdout and stderr — no machine-readable diagnostic at all.

The documented contract (`docs/design/cli.md` §9) is the opposite:
`--quiet` suppresses progress notices but **preserves the body**.

The two offenders live in `packages/cli/src/output/formatter.ts`:
`output()` early-returns on `quiet`, and `outputError()` sets
`process.exitCode = 1` and returns without emitting the envelope.

## Plan

1. `output(data, fmt)` — drop the `quiet` parameter; always print the body.
2. `outputError(error)` — drop the `quiet` parameter; always emit the
   `{"error":{code,message}}` envelope on stderr and set exit code 1.
   Removing the parameter (rather than ignoring it) keeps a dead
   `quiet` argument from being threaded back in later.
3. Update every call site in `packages/cli/src/commands/*` and
   `packages/cli/src/**` accordingly.
4. Reword the `--quiet` flag help from "Suppress output" to something
   that states what it actually gates.
5. Leave every other `quiet` check alone — the stderr notices in
   `docs/content.ts`, `output/binary.ts`, `commands/docs.ts`,
   `commands/sheets-export.ts`, `docs/import.ts` are exactly the
   progress output `--quiet` is *supposed* to suppress.
6. Tests in `packages/cli/test/output.test.ts`: replace the
   "honors quiet" case with cases asserting the body and the error
   envelope survive; the flag no longer reaches these functions.
7. Docs: clarify §9 of `docs/design/cli.md` (errors are never
   suppressed) and the CLI README global-flag line.

## Acceptance criteria (from the issue)

- [ ] `wafflebase schema --quiet` prints the same body as without `--quiet`.
- [ ] A failing command under `--quiet` still prints the JSON error
      envelope on stderr and exits non-zero.
- [ ] `--quiet` still suppresses progress notices (the `md` lossy
      notice, page-range warnings, "Wrote N bytes to X", etc.).

## Non-goals

- No change to exit codes, error codes, or the `--out`/binary paths.
- No new flags (no `--silent`).
