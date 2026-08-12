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

Scope note (revised while implementing): the original note deferred every
emitter that bypasses `outputError`. That does not survive contact with the
acceptance criteria — the emitters that *forward a backend error body*
(`docs.ts`/`slides.ts`/`notes.ts`, `src/docs/import.ts`, `src/notes/import.ts`,
`src/slides/import.ts`, `src/files/*`, `schema.ts`) emit the very envelope
#661 defines, so leaving them pretty-printed and unattributed would make
"the envelope is a single line carrying `command`" false on the paths agents
hit most. They are converted here through a shared `backendErrorEnvelope`.
What stays deferred to #654/#655 is the *interactive prose* in `login` and
`ctx switch` — messages written for a human setting up a session, on no
agent-driven path.

## Plan

- [x] `formatter.ts`: drop `null, 2`; add an optional `command` parameter to
      `outputError` and populate `error.command` with the command's dotted
      path (`docs.content`), matching the names `schema` uses.
- [x] Add a `commandPath(cmd)` helper that walks commander's `parent` chain
      and excludes the root program.
- [x] Thread `this` (the commander action's `Command`) at every
      `outputError` call site: docs, slides, notes, cells, files, tabs,
      api-keys, sheets-import, sheets-export.
- [x] `cli.ts`: capture the running command with a `preAction` hook so the
      last-resort catch can attribute the error too.
- [x] Export `errorEnvelope` / `backendErrorEnvelope` and route the
      backend-body emitters through them, preserving the upstream `code` and
      extra context while never accepting a server-supplied `command`.
- [x] Tests: single-line assertion, `command` present per call site, absent
      when unattributable; update the two existing `toEqual` envelope
      assertions in `test/output.test.ts`.

## Acceptance criteria (from the issue)

- [x] The envelope is a single line on stderr (no embedded newlines).
- [x] It carries `command` with the dotted command name, e.g.
      `wafflebase docs content d1 …` → `"command":"docs.content"`.
- [x] `code`/`message` behavior (including preserved subclass codes) is
      unchanged.
