# Data sources in workspace settings — lessons

- `capture-before-after.mjs --base` passed through a zsh variable (`$B`) is
  not word-split, so the flag silently fell back to `:5173` — which was a
  *different checkout's* Vite. Identical before/after PNGs are the tell; check
  the served URL (`--steps` logging `page.url()`) before trusting a shot.
- Running this tree's frontend on another port needs the backend restarted
  with `FRONTEND_URL` set to that origin (CORS allow-list is a single origin).
- Seeding a workspace by hand needs a UUID id: `resolveId` treats anything
  else as a slug, so a non-UUID id 404s every workspace-scoped route.

## Self-review

- Round 1 (correctness/tests): no blocking findings, loop stopped. Fixed
  minors anyway: stale file refs in `docs/design/sheets/datasource.md` (would
  also fail the pre-push entropy check), per-row test status (a shared
  `testingId` dropped a spinner), stale "Connected" after an edit, and a
  refetch error hiding an already-loaded list; added a Test connection test.
  Disputed: "`--success` is undefined" — it is defined in `packages/core`
  `tokens.css`. Deferred as pre-existing: delete without confirmation, SSL
  badge vs `rejectUnauthorized: false`, verbatim test-connection errors,
  member-level edit/delete (backend is `assertMember` by design).
- Don't run `prettier --write` on a whole existing test file: it reformatted
  ~250 untouched lines. Edit, then let lint report.
