# Desktop app — Phase 0 + 1

Design: `docs/design/desktop-app.md`. Goal of this task: a first build that
runs — a Tauri shell that loads a deployment, intercepts GitHub sign-in, runs
it in the system browser and comes back signed in. Google `mode=desktop`,
signing, updater, `test:webkit` in CI and Linux stay Phase 2.

## Contract (shared by backend and shell)

- Shell intercepts top-level navigations to `<backend>/auth/github` whose
  query has no `mode`.
- `GET <backend>/auth/providers` → `{ github, google, desktop: { github,
  google } }`. A response without `desktop.github === true` means the server
  cannot do desktop sign-in.
- Shell opens `http://127.0.0.1:<port>/launch/<token>`, which redirects once
  to `<backend>/auth/github?mode=desktop&port=<port>&nonce=<64 hex>&challenge=<base64url(sha256(verifier))>`.
- Backend: same confirmation page and state handling as `mode=cli`, worded
  for the desktop app; callback redirects to
  `http://127.0.0.1:<port>/callback?code=<code>&state=<nonce>`.
- Codes record their mode. `cli/exchange` refuses a desktop code and
  `desktop/session` refuses a CLI code.
- Shell loads its bundled handoff page, which top-level POSTs
  `application/x-www-form-urlencoded` `code`, `verifier` to
  `<backend>/auth/desktop/session`.
- Backend: `403` unless `Origin` is `tauri://localhost`,
  `http://tauri.localhost` or `https://tauri.localhost` (checked before the
  code is consumed); bad code → `303 FRONTEND_URL/login?error=desktop_session`;
  success → `setAuthCookies` + `303 FRONTEND_URL`.

## Backend (`packages/backend/src/auth/**`, owner: backend agent)

- [ ] `mode=desktop` on `GET /auth/github` (guard, confirm middleware, state)
- [ ] Mode recorded on `CliAuthStore` codes; cross-mode redemption refused
- [ ] `POST /auth/desktop/session` with the Origin rule
- [ ] `desktop` field on `GET /auth/providers`
- [ ] Unit tests for each; `pnpm backend test` green
- [ ] `docs/design/backend.md`, `docs/design/rest-api.md`, backend README auth tables

## Shell (`packages/desktop/**`, owner: shell agent)

- [ ] Tauri 2 package `@wafflebase/desktop`, pnpm workspace member, indexed
- [ ] Bundled server picker; URL validation (https, or http on loopback);
      profile persisted; "Change server…" menu item
- [ ] Remote origin has no capability; picker/handoff pages only
- [ ] Navigation policy: frontend origin in-window, auth intercept, new
      windows for frontend origin, other origins to the system browser
- [ ] Loopback listener + PKCE in Rust with the CLI's rules; Rust tests
- [ ] Handoff page; `blob:` downloads saved to disk
- [ ] Menus (app + Edit), window-state, single-instance, opener
- [ ] `cargo test` and `tauri build --debug` green on macOS

## Integration (lead)

- [ ] Local end-to-end: backend with a fake GitHub OAuth server, frontend
      dev server, desktop app; signed in inside the app window
- [ ] Self-review rounds (max 3) logged in lessons
- [ ] Design doc updated with what the spike found
