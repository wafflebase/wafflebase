# Lessons — CLI `status` / `ctx list` structured output (#635)

## The global `--format` flag is overloaded on purpose

The obvious fix for "`--format bogus` is silently accepted" is
`commander`'s `.choices(['json','table','csv'])` on the global option in
`createProgram()`. That would have broken `docs content --format md`,
`docs export out.pdf --format pdf`, `slides export --format pptx`, and
`notes export --format md`: those commands deliberately **do not**
redeclare `--format` and instead reuse the global one, validating the
value themselves (`parseContentFormat`, `detectExportFormat`). Two
source comments in `commands/docs.ts` spell this out. Validation has to
stay per-command; the shared helper is `parseOutputFormat()` for
commands that actually render through `output()`.

## `wafflebase schema` already declared the intended shapes

`src/schema/registry.ts` had `ctx.list` documented as
`array of { id, name, active }` and `status` as `{ user, server,
workspace, session }` long before either command emitted JSON — the
registry was the spec and the implementation had drifted from it. Worth
checking the registry first when fixing any CLI output: it says what
agents were promised.

## Flat payloads over nested for CLI output

`formatTable` and `formatCsv` operate on records of scalars; a nested
`{ user: { username, email } }` renders as `[object Object]` in a table
and a JSON blob in CSV. Since the non-JSON formats are now the *human*
path (JSON being the default), `status` emits a flat record.
