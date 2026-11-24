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

### Round 2 — design fit (one reviewer, whole branch)

- No blocking findings, so the loop stops here.
- Fixed: the design doc's Google rows now say Phase 2 (only GitHub is
  intercepted); stale §1/§3 statements (command list, file layout, the
  sign-in hand-off path); downloads restricted to the frontend's own `blob:`
  URLs and origin, since on macOS WebKit routes `<a download>` to the
  download hook before any navigation check; a 15-second timeout on the
  handoff page when the backend's `FRONTEND_URL` differs from the origin
  chosen in the app; Windows subframe behaviour noted next to the macOS one;
  backend docs no longer claim a cross-site start is refused outright.
- Known limitations, not fixed: `cargo test`/`clippy` for the new crate are
  not in `verify:fast` or CI; `WAFFLEBASE_DESKTOP_SERVER` works in release
  builds (needs local control, documented as a development override);
  bundled pages accept a same-window navigation from the remote origin and
  `take_handoff` is not tied to a window (defense in depth only, nothing
  produces such a navigation).
- **Lesson: page-load events miss client-side routing.** The first plan was
  to track each window's current page from `on_page_load`, but the frontend
  reaches `/login` through React Router, which fires no load. Reading the
  webview's URL when the decision is needed was the only reliable source.

### CodeRabbit rounds on PR #1195

- Round 1 (`e5c0affc`, 12 comments) was only partly covered by
  `dcafe584`. Fixed now: `rust-version` 1.80 → 1.90 (`tauri` 2.12.7
  declares 1.90; a 1.83 toolchain fails on `edition2024` before compiling
  anything), a page-load failure now bumps the sign-in generation so a
  worker still checking the server cannot arm or complete over it,
  `cancel_login` and `take_handoff` act only for the window the sign-in
  runs in, a `HEAD` on the launch link answers `405` without spending it,
  the callback page no longer says "signed in" before the session POST,
  `desktopSession` 303s when the user lookup throws (the code is already
  spent), and the docs name the throttled routes and the same-origin
  one-shot caveat.
- Not changed: the `unbound-method` spec assertions (63 of the same on
  `main`, backend lint is in no verify lane).
- Round 2 (`dcafe584`, 1 comment): the sign-in link race is real but its
  suggested fix (`is_frontend(url)`) breaks a backend on its own origin.
  Recorded as an accepted risk; pinning the backend origin after the first
  sign-in is the follow-up.
- **Lesson: "passed locally" for a Rust crate needs the toolchain named.**
  The declared MSRV was never built: the machine's default stable could not
  even parse the dependency graph. Build once with `cargo +<rust-version>`.
