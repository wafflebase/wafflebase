# Desktop app — Phase 0 + 1

Design: `docs/design/desktop-app.md`. Goal of this task: a first build that
runs — a Tauri shell that loads a deployment, intercepts GitHub sign-in, runs
it in the system browser and comes back signed in. Google `mode=desktop`,
signing, updater, `test:webkit` in CI and Linux stay Phase 2.

## Contract (shared by backend and shell)

- Shell intercepts same-window navigations to `<backend>/auth/github`
  whose query has no `mode`, and only from the frontend's `/login` page
  (narrowed in review round 1).
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
- Backend: `403` unless `Origin` is `tauri://localhost` or
  `http://tauri.localhost`, the two origins the app is served from (checked
  before the code is consumed; `https://tauri.localhost` is Tauri's
  `useHttpsScheme`, which this app does not set, so it is refused);
  bad code → `303 FRONTEND_URL/login?error=desktop_session`;
  success → `setAuthCookies` + `303 FRONTEND_URL`.

## Backend (`packages/backend/src/auth/**`, owner: backend agent)

- [x] `mode=desktop` on `GET /auth/github` (guard, confirm middleware, state)
- [x] Mode recorded on `CliAuthStore` codes; cross-mode redemption refused
- [x] `POST /auth/desktop/session` with the Origin rule
- [x] `desktop` field on `GET /auth/providers`
- [x] Unit tests for each; `pnpm backend test` green
- [x] `docs/design/backend.md`, `docs/design/rest-api.md`, backend README auth tables

## Shell (`packages/desktop/**`, owner: shell agent)

- [x] Tauri 2 package `@wafflebase/desktop`, pnpm workspace member, indexed
- [x] Bundled server picker; URL validation (https, or http on loopback);
      profile persisted; "Change server…" menu item
- [x] Remote origin has no capability; picker/handoff pages only
- [x] Navigation policy: frontend origin in-window, auth intercept, new
      windows for frontend origin, other origins to the system browser
- [x] Loopback listener + PKCE in Rust with the CLI's rules; Rust tests
- [x] Handoff page; `blob:` downloads saved to disk
- [x] Menus (app + Edit), window-state, single-instance, opener
- [x] `cargo test` and `tauri build --debug` green on macOS
- [ ] A CI job that runs the crate's `cargo test`. `verify:self`'s
      `desktop:check` lane reaches only what Node can see: the Ubuntu runner
      has no WebKit/GTK development libraries, so the crate cannot compile
      there, and the Rust suite is run by hand on macOS until a platform job
      in `.github/workflows/ci.yml` takes it over

Verified unattended on macOS: picker and IPC on bundled pages, remote origin
refused every command, full sign-in against fake servers (smoke hooks in the
package README). Not yet exercised at a real window: a `blob:` download, menu
clicks, single-instance focus and `window.open` app windows.

## Integration (lead)

- [x] Local end-to-end: backend with a fake GitHub OAuth server, frontend
      dev server, desktop app; signed in inside the app window
- [x] Self-review rounds (max 3) logged in lessons
- [x] Design doc updated with what the spike found
