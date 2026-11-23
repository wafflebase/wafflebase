# Desktop app — lessons

- **A fresh worktree fails `verify:fast` until the libraries are built.**
  `slides` and `cli` typecheck against `@wafflebase/docs` and
  `@wafflebase/slides/node` from `dist`, so a new worktree needs
  `pnpm core build`, `docs`, `sheets`, `slides` and `board` builds before the
  pre-commit hook passes. The failure looks like a code error
  (`TS2307: Cannot find module`), not a setup step.
- **GitHub sign-in can be tested end to end without GitHub.** The
  `GITHUB_*_URL` overrides that exist for GitHub Enterprise also accept a
  local fake OAuth server, which lets the whole CLI and desktop flow run
  against a real backend with no credentials.
- **No UI automation, so the smoke path needs hooks.** Clicking a native
  window needs Accessibility permission, and the probe hangs waiting for it.
  Debug-only environment variables (a replacement for the system browser,
  and a sign-in trigger) let the real app run the full flow unattended.

## Self-review rounds

### Round 1 — correctness and security (two reviewers: backend, shell)

- Backend: no blocking findings. Accepted-risk rows added to the design
  doc for `*.localhost` Origins (F3) and for the CLI-inherited gap where
  the confirmation middleware answers a cross-site start before the guard's
  `Sec-Fetch-Site` check runs (F1). F1 is not fixed here: it predates this
  work, and enforcing the check in the middleware could refuse genuine
  sign-ins depending on how browsers report `Sec-Fetch-Site` after the
  loopback `/launch` redirect, which is unverified. Follow-up issue.
- Shell, blocking B1: intercepting `/auth/github` on any origin let a
  collaborator's hyperlink start a sign-in against an attacker origin and
  render its page in the app window. Fixed by trusting only the frontend's
  own login page as the source of the intercept, and never leaving a
  session response rendered. Non-blocking N1–N4 (listener lifetime,
  generation race, framing of bundled pages, bundled-origin check) fixed in
  the same round.
- **Lesson: "intercept by path on any origin" trusts the URL, not who
  produced it.** A desktop shell around a collaborative app renders content
  any collaborator can author, so every navigation hook has to ask where
  the navigation came from, not only where it goes.
