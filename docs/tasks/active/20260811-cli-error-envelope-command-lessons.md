# Lessons — CLI error envelope: single line + `command` field

Issue: #661

## Notes

- Every `outputError` call site already lives inside a commander action
  declared as `async function (this: Command, …)`, so the command object was
  in scope at all ~40 of them — threading `this` needed no signature
  plumbing through helper modules.
- The last-resort catch in `runCli` has only the root `program`, which does
  not know which subcommand ran. Commander's `preAction` lifecycle hook,
  registered on the root, fires for subcommand actions and hands over the
  acting `Command` — that is what lets the entrypoint's envelope carry
  `command` too, instead of dropping the field exactly where an unhandled
  rejection makes attribution most valuable.
- Re-emitting a backend body through the envelope is lossy unless you look
  past `error.message`. There is no global exception filter in the backend —
  only `docs-content.controller.ts` hand-builds `{ error: { code, message } }`
  — so most failures arrive in Nest's default `{ statusCode, message, error }`
  shape, where `error` is a bare reason phrase and the real text is top-level
  (and can be a `message[]` from `ValidationPipe`). `backendErrorEnvelope`
  reads `error.message` → `message` → `error`-as-string, so converting a path
  that used to print the body verbatim never costs the server's reason.
- A converted failure path needs a test that *drives* it, not just a builder
  test. `login`'s three `failFromBackend` call sites were the only new
  emitter with no coverage at all: the login test stubbed every backend call
  to `200`, so nothing ever reached the envelope. The gap also hid a real
  question — `failFromBackend` is typed `Promise<never>` but the call sites
  `await` it and the code below continues to `exchangeRes.json()`, so
  "does it actually stop?" is only answerable by running it. Spying
  `process.exit` to throw makes both the exit code and the halt observable.
- The dotted name (`docs.content`) is the commander `parent` chain minus the
  root program. Aliases resolve for free: `name()` returns the canonical
  name, so `wafflebase doc content` still reports `docs.content` — the same
  string the `schema` command uses.
