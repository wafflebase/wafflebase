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
