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

## Adding a `default:` throw to a shared formatter needs a call-site audit

Giving `format()` a validating `default:` branch is only safe if every
`output()` caller is inside a `try/catch` that routes to `outputError`.
`commands/schema.ts` was the one exception out of 31 call sites, and
`bin.ts` has no top-level handler — so `wafflebase schema --format
bogus` went from printing a literal `undefined` (exit 0) to dumping a
Node stack trace. Self-review caught it; the smoke test that found it
was two commands long. Widening a shared helper's failure mode is a
call-site audit, not a local change.

The same applies to widening what a shared *renderer* accepts:
teaching `formatTable` to render a single object reached
`schema --format table`, which passes `{ commands: [...] }` and started
printing `[object Object]`. `formatCsv` had already solved that by
JSON-serializing non-scalars; the new path had to do the same.

## Flat payloads over nested for CLI output

`formatTable` and `formatCsv` operate on records of scalars; a nested
`{ user: { username, email } }` renders as `[object Object]` in a table
and a JSON blob in CSV. Since the non-JSON formats are now the *human*
path (JSON being the default), `status` emits a flat record.

## A conflicting PR stops receiving `pull_request` CI, which stalls the loop

Round 4's fix commit (`033e14fc2`) was pushed on 2026-08-10 and then
nothing happened for five days: no CI run, no panel round, and
`agent:fixing` latched on the PR. The cause was not the fixer. Between
round 4's commit (2026-08-06) and that push, `main` merged #694
(dropped `quiet` from `output()`/`outputError()`) and #729 (added
`--format yaml`), which made the branch conflict. GitHub could no
longer compute the PR's merge ref, so the push produced **no**
`pull_request: synchronize` workflow run at all — `gh api
.../commits/033e14fc2/check-runs` returns an empty list and the branch's
last `CI` run is still the one created on 2026-08-06. The `@claude
rerun` earlier that day worked only because it *re-ran an existing*
workflow run rather than dispatching a new one.

The lesson for a long-lived agent branch: a merge conflict is not just a
merge problem, it silently removes the branch from CI, and every stage
of the pipeline that keys off CI stops with it. Merge `main` into the
branch on a cadence rather than waiting for the loop to complain.

## `--format` guards must be re-applied to call sites `main` adds

This branch converted every `output()` call site to narrow the raw flag
through `parseOutputFormat()` *before* the request, because `format()`
now throws — after a mutation, that throw turns a completed write into
exit 1 / `INVALID_FORMAT` with the response body discarded. While the
branch sat, `main` added six new call sites that predate the rule:
`tabs create`/`tabs rename` (#708) and the whole `files` namespace
(#703, `list`/`get`/`rename`/`delete`). Merging cleanly left all six
passing `opts.format` straight to `output()` — no conflict marker, no
type error, and the PR's own point regressed on exactly the commands
`main` had just shipped.

Textual conflict resolution is not enough for a change whose thesis is
"every call site does X". After the merge, re-run the audit that
justified the change (`grep -rn "output(.*opts\.format" packages/cli/src`
here) and treat any survivor as a conflict the merge did not report.
