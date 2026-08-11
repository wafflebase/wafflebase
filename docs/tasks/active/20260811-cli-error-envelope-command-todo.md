# CLI error envelope: single line + `command` field

Issue: #661

## Problem

`outputError` (`packages/cli/src/output/formatter.ts`) emits the error
envelope as pretty-printed JSON (`JSON.stringify(..., null, 2)`) and never
carries the `command` field the docs specify:

- `packages/cli/README.md` — "a single JSON line on stderr"
- `docs/design/cli.md` §8.1 / §9 —
  `{"error":{"code":"…","message":"…","command":"docs.content"}}`

Line-orientation lets a caller read stderr with a line-delimited parser and
match one error to one command; `command` is what tells an agent driving
several calls *which* call failed.

Scope note: this is the shape emitted when the shared envelope path is taken.
Hand-rolled emitters that bypass `outputError` (forwarded upstream bodies in
`docs.ts`/`slides.ts`/`notes.ts`, `src/docs/import.ts`, `src/files/*`,
`schema.ts`) are the subject of #654/#655 and are left alone here.

## Plan

- [ ] `formatter.ts`: drop `null, 2`; add an optional `command` parameter to
      `outputError` and populate `error.command` with the command's dotted
      path (`docs.content`), matching the names `schema` uses.
- [ ] Add a `commandPath(cmd)` helper that walks commander's `parent` chain
      and excludes the root program.
- [ ] Thread `this` (the commander action's `Command`) at every
      `outputError` call site: docs, slides, notes, cells, files, tabs,
      api-keys, sheets-import, sheets-export.
- [ ] `cli.ts`: capture the running command with a `preAction` hook so the
      last-resort catch can attribute the error too.
- [ ] Tests: single-line assertion, `command` present per call site, absent
      when unattributable; update the two existing `toEqual` envelope
      assertions in `test/output.test.ts`.

## Acceptance criteria (from the issue)

- [ ] The envelope is a single line on stderr (no embedded newlines).
- [ ] It carries `command` with the dotted command name, e.g.
      `wafflebase docs content d1 …` → `"command":"docs.content"`.
- [ ] `code`/`message` behavior (including preserved subclass codes) is
      unchanged.
