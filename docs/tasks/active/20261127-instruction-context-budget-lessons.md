# Instruction context budget — lessons

## What went wrong

- `CLAUDE.md` used `@path` for reference READMEs. `@` is an import, not a
  link: every session paid for the backend README's 93k of env-var notes,
  and once past 150k Claude Code dropped the four engine READMEs instead.
  Rule: link reference material with a plain path; reserve `@` for text
  every task needs.

## Workflow notes

- A read-only audit fan-out (one agent per source, a shared A–E rubric, a
  schema for the result) gave tables that merged without conflicts. Asking
  each agent to verify against the code mattered: writers corrected 3 of the
  briefed facts (v1 write-scope guard is per controller, `backend migrate`
  hardcodes `--name init`, the core tsconfig wildcard already exists).
- The fresh reviewer caught 2 wrong rules the writers had verified to their
  own satisfaction (frontend tests are mostly colocated; core `exports` point
  at `dist`). One finding was wrong: the "missing" packages
  (`design-editor`, `design-sandbox`, `debug-report`) are untracked local
  dirs. Check `git ls-files` before trusting a directory listing.
- A path-scoped rule's load can be checked headlessly: `claude -p` that reads
  a file in scope, against a control that reads one outside it.
- A new `scripts/*.mjs` must be indexed in `scripts/README.md`, or
  `verify:doc-index` fails `verify:fast`.

## Self-review

- Round 1 — blocked on correctness (paths:-scoped rules may not load:
  disputed in `-rebuttals.json` with the docs quote and the headless control
  run) and test-adequacy (no over-budget failure test: added). Also fixed
  three minors: reuse `prose()` from verify-doc-links instead of a weaker
  `stripCode`, warn on an `@` import that resolves to nothing, and make the
  CLAUDE.md pointers links so `verify:doc-links` checks them. Deferred: a
  `.claude/**`-only PR runs no CI lane (pinned by
  `verify-self-lanes.test.mjs`).
