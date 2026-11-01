# Live document-title sync — Lessons

- A value that lives outside the CRDT (Postgres) is invisible to peers unless
  something pushes it. When a bug report names one editor, check whether the
  data path is shared — here every type had the same gap.
- `@yorkie-js/sdk` 0.7.25 has no `Document.broadcast`; broadcast moved to
  `Channel`. Presence is the cheapest per-document signal already attached.
- `verify:fast` CLI typecheck reads `@wafflebase/slides` from its built `dist`;
  after main adds exports, rebuild docs + slides before trusting a red lane.
