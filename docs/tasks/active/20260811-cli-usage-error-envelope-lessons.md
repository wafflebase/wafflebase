# Lessons — CLI usage-error envelope (issue #654)

## `exitOverride()` alone is not enough

`.exitOverride()` only replaces `process.exit`; commander has *already*
written `error: missing required argument 'doc-id'` to stderr by then
(`Command.prototype.error` writes first, exits second). Suppressing that
write needs the separate `outputError(str, write)` output hook. Overriding
`writeErr` instead would have been wrong: `writeErr` is also what
`outputHelp({ error: true })` uses, so bare `wafflebase` would have gone
silent.

## Inheritance is by reference, and it is order-dependent

`copyInheritedSettings` copies `_exitCallback` **at `.command()` time**, so
the root must be configured before any subcommand is registered — which is
exactly what `createProgram()` (root config) followed by `buildProgram()`
(registration) already does. `_outputConfiguration` is copied as a shared
object reference and `configureOutput` mutates it in place, so that half
would propagate either way; the exit callback would not.

## Help and version travel the same error path

`--help`, `--version`, and bare `wafflebase` all reach the catch as a
`CommanderError` (`commander.helpDisplayed` / `commander.version` /
`commander.help`). Enveloping everything caught would have turned
`wafflebase --help` into `{"error":{"code":"USAGE","message":"(outputHelp)"}}`
— the body text is already on the stream and the exit code is the only thing
left to preserve.
