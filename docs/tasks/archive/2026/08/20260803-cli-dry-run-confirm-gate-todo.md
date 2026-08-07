---
title: CLI `import --replace --dry-run` must skip the confirmation gate
issue: 593
---

# CLI: `import --replace --dry-run` is blocked by the confirmation gate

## Problem

`docs import --replace <id> --dry-run` returns `CONFIRMATION_REQ` (exit 1)
on a non-TTY shell and prompts on a TTY, even though a dry run mutates
nothing. The `--replace` confirmation gate runs *before* the `dryRun`
branch, so the preview never gets a chance to short-circuit.

`docs/design/cli.md:724` already documents the intended contract —
"`docs import --replace`: preview the PUT only; `--yes` is ignored" — and
`cli.md:794` tells agents to "confirm or use `--dry-run` first", advice
that today cannot be followed non-interactively without also passing the
destructive `--yes`.

Same ordering bug in `notes import` and `slides import`.

## Decision

Fix the code, not the doc: gate confirmation on `!dryRun`. A preview has
nothing to confirm, and this makes the documented sentence true as
written.

## Tasks

- [x] `packages/cli/src/docs/import.ts` — skip the gate when `dryRun`
- [x] `packages/cli/src/notes/import.ts` — same
- [x] `packages/cli/src/slides/import.ts` — same
- [x] Tests: `--replace --dry-run` without `--yes` on non-TTY → exit 0 +
      PUT plan on stdout, no HTTP calls; on a TTY → no prompt
- [x] Docs: state the `--dry-run` exemption where the
      `CONFIRMATION_REQ`/`--yes` contract is described
      (`docs/design/cli.md` error matrix, `packages/cli/README.md`-adjacent
      skill files, `packages/documentation/developers/cli.md`)

## Non-goals

- Any change to the destructive path itself (`--replace` without
  `--dry-run` still requires `--yes` / an interactive `y`).
- Touching the non-`--replace` dry-run paths, which are already correct.
