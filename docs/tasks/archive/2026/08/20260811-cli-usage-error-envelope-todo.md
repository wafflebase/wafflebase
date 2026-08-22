# CLI — route commander parse errors through the JSON envelope (issue #654)

## Problem

`packages/cli/README.md` and `docs/design/cli.md` §8.1 promise every
failure as `{"error":{"code":"…","message":"…"}}` on stderr, because the
CLI's stated audience is agent drivers that parse stderr as JSON. Commander
exits *during parsing*, before any action handler runs, so its own failures
print bare prose instead:

```
$ wafflebase docs content
error: missing required argument 'doc-id'
```

The envelope machinery itself is fine — `outputError`
(`packages/cli/src/output/formatter.ts`) emits the documented shape and is
reached for every runtime failure. Only the parse path bypasses it, and a
mistyped flag or missing argument is the most likely error an agent driver
hits.

## Scope

`packages/cli` only — `src/commands/root.ts` (root program config),
`src/cli.ts` (the `runCli` catch), plus tests and the two docs that state
the contract. No change to `outputError`, no new command behavior.

## Plan

- [x] `createProgram()`: `.exitOverride()` so commander throws a
      `CommanderError` instead of calling `process.exit`, and
      `.configureOutput({ outputError: () => {} })` so its prose never
      reaches stderr. Both are set before any subcommand is registered, so
      `copyInheritedSettings` (exit callback) and the shared
      `_outputConfiguration` object give every subcommand the same behavior.
- [x] `runCli()`: translate a caught `CommanderError` into the envelope with
      a stable `USAGE` code, stripping commander's `error: ` prefix from the
      message.
- [x] Leave `--help` / `--version` / bare `wafflebase` alone: those exit
      through the same `CommanderError` path (`commander.help`,
      `commander.helpDisplayed`, `commander.version`) but have already
      written their body and are not failures. Preserve their exit code and
      emit nothing.
- [x] Tests in `test/output.test.ts` covering the four reproductions from the
      issue plus the help/version passthrough.
- [x] Update the contract text in `packages/cli/README.md` and
      `docs/design/cli.md` §8.1 to name `USAGE`.

## Acceptance criteria (from the issue)

- `wafflebase docs content` → single JSON error envelope on stderr, exit 1.
- `wafflebase docs content --bogus-flag` → same.
- `wafflebase sheets get` (unknown command) → same.
- `wafflebase docs export` → same.
- The envelope carries a stable code an agent can branch on (`USAGE`).
