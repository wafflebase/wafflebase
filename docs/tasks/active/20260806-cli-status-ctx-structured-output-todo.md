# CLI: route `status` / `ctx list` through `output()` (#635)

## Problem

`docs/design/cli.md` §8.1 promises "All output is JSON by default. Errors
are also JSON so agents can parse success and failure uniformly." Two
commands break that contract:

- `wafflebase status` prints bare English sentences via `console.log`,
  never reads `opts.format`, and never calls `output()`.
- `wafflebase ctx list` does the same (prose `*`-marker list).
- Both silently accept `--format bogus` — no signal that the value is
  unsupported.

`status` is the first command an agent runs to decide whether to prompt
for login, so `JSON.parse` on its stdout throws at the very start of a
session.

## Approach

1. Add `parseOutputFormat()` to `src/output/formatter.ts` — validates a
   raw `--format` value against `json | table | csv` and throws an
   `Error` carrying `code = 'INVALID_FORMAT'` so `outputError()` emits a
   structured JSON body. Also give `format()` a validating `default:`
   branch so no command can `console.log(undefined)` on a bad format.
   The global `--format` flag is deliberately overloaded by
   `docs/slides/notes content|export` (`md`/`text`/`pdf`/`docx`/`pptx`),
   so validation must stay per-command — commander `.choices()` on the
   global option would break those.
2. `status`: build a flat structured payload and route it through
   `output()`. Flat (not nested) so `--format table` / `--format csv`
   render usefully — that is the documented human path now that JSON is
   the default.
3. `ctx list`: emit `[{ id, name, active }]` — exactly the shape
   `wafflebase schema ctx.list` already declares. Drop the prose
   `formatWorkspaceList` helper; `--format table` covers the human view.
4. Update the `status` response shape in `src/schema/registry.ts` to
   match what the command now emits.
5. Tests in `test/status.test.ts` / `test/ctx.test.ts` over the pure
   payload builders + `parseOutputFormat`.
6. Touch up `docs/design/cli.md` where it describes the prose output.

## Emitted shapes

`status`, logged in:

```json
{
  "loggedIn": true,
  "user": "hackerwins",
  "email": "h@example.com",
  "server": "http://localhost:3000",
  "workspaceId": "e98ff707-...",
  "workspaceName": "hackerwins's Workspace",
  "session": "valid",
  "expiresAt": "2026-08-07T00:00:00.000Z"
}
```

`status`, not logged in (still exit 0 — reporting "no session" *is* the
command succeeding):

```json
{
  "loggedIn": false,
  "message": "Not logged in. Run `wafflebase login`."
}
```

`ctx list`:

```json
[{ "id": "e98ff707-...", "name": "Team Workspace", "active": true }]
```

## Decisions

- **`status` exits 0 when not logged in.** It answered the question it
  was asked; agents branch on `loggedIn`.
- **`ctx list` exits 1 with a JSON `NOT_LOGGED_IN` error when there is
  no session.** It cannot list anything, and sibling `ctx switch`
  already errors + exits 1 in that state. This is a behavior change
  beyond the literal ask; disclosed in the PR.
- Keep `ctx switch` prose as-is: out of scope for this issue.

## Checklist

- [x] `parseOutputFormat()` + validating `format()` default in
      `src/output/formatter.ts`
- [x] `status` routed through `output()`; `--format` honoured; bogus
      rejected
- [x] `ctx list` routed through `output()`; `--format` honoured; bogus
      rejected
- [x] `schema` registry `status` response updated
- [x] unit tests: status payload, ctx list payload, format validation
- [x] `docs/design/cli.md` prose references updated
- [x] draft PR opened, `Fixes #635`
- [x] `schema` wrapped in try/catch (found in self-review: it was the
      only `output()` caller without one, so `format()`'s new throw
      escaped as an uncaught exception)
- [x] `formatTable` JSON-serializes nested values (found in
      self-review: `schema --format table` printed `[object Object]`)
- [x] `packages/documentation/developers/cli.md` (published page)
      updated — it still advertised the deleted `*` active marker
