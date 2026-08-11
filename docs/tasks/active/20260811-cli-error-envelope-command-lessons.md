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
- The dotted name (`docs.content`) is the commander `parent` chain minus the
  root program. Aliases resolve for free: `name()` returns the canonical
  name, so `wafflebase doc content` still reports `docs.content` — the same
  string the `schema` command uses.
