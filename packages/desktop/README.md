# @wafflebase/desktop

The Wafflebase desktop app: a [Tauri 2](https://tauri.app) shell that opens a
team's own Wafflebase deployment in a native window. It ships no editor code.
It loads the deployment's frontend from its URL, so the server decides which
version of Wafflebase people see, and a server upgrade needs no app release.
Sign-in runs in the system browser and comes back through the loopback + PKCE
flow the CLI uses. The design is
[docs/design/desktop-app.md](../../docs/design/desktop-app.md).

Status: Phase 0 + 1, plus the release half of Phase 2: signed and notarized
macOS builds and the in-app updater, published with every server release (see
[Releasing](#releasing)). Google desktop sign-in, Authenticode for Windows and
`test:webkit` in CI are still open.

## Layout

| Path | What |
|------|------|
| `src/` | Bundled pages, plain HTML/CSS/JS: server picker (`index.html`), sign-in status (`signin.html`), sign-in handoff (`handoff.html`), unreachable server (`offline.html`) |
| `src-tauri/src/server.rs` | Server profile: URL validation, `server.json` in the app config dir |
| `src-tauri/src/connection.rs` | Reachability probe before a server is opened, retry backoff, the unreachable-server page's state (tested) |
| `src-tauri/src/navigation.rs` | Navigation, new-window and download policy (pure, tested) |
| `src-tauri/src/login.rs` | Loopback listener + PKCE, with the CLI's rules (tested) |
| `src-tauri/src/signin.rs` | Sign-in orchestration: providers check, browser, handoff |
| `src-tauri/src/update.rs` | Updater: silent launch/daily check installed on quit; menu check with Restart Now / Later |
| `src-tauri/src/lib.rs` | Windows, hooks, menu, plugins, commands |
| `src-tauri/capabilities/local.json` | IPC for the bundled pages only |
| `app-icon.svg` | Icon source; `pnpm icon` regenerates `src-tauri/icons/` |

## Prerequisites

- Rust stable (`rustup`), 1.90 or newer (`tauri` 2.12 requires it).
- macOS: Xcode Command Line Tools (`xcode-select --install`).
- Windows: the Microsoft C++ Build Tools and WebView2 (preinstalled on
  Windows 11). See Tauri's
  [prerequisites](https://tauri.app/start/prerequisites/).
- Node and pnpm as for the rest of the repository (`pnpm install` at the root
  installs the Tauri CLI).

## Commands

```bash
pnpm --filter @wafflebase/desktop dev          # run the app (debug build)
pnpm --filter @wafflebase/desktop build        # release bundles (.app/.dmg, NSIS)
pnpm --filter @wafflebase/desktop build:debug  # debug .app only, faster
pnpm --filter @wafflebase/desktop test         # cargo test
pnpm --filter @wafflebase/desktop lint         # cargo clippy -D warnings
pnpm --filter @wafflebase/desktop check        # page scripts + JSON config (the verify:self lane)
```

The debug bundle lands at
`src-tauri/target/debug/bundle/macos/Wafflebase.app`. `test` and `lint` are
not part of `pnpm verify:fast`: they need a Rust toolchain the other packages
do not. CI runs them in the `verify-desktop (macOS)` job of
`.github/workflows/ci.yml` whenever this package changes, on the crate's
`rust-version` (1.90); Linux runners cannot build the crate without the
WebKitGTK development libraries.

## Choosing a server

The app opens the official server, `https://wafflebase.io`, until another is
chosen, and it opens every server at `/login` (a signed-in user is sent on to
their documents from there).

The app menu's **Change server…** opens the picker, which asks for the
deployment's address, the one people open in a browser. It must be
`https://`, or `http://` on `localhost`, `127.0.0.1` or `[::1]`, the same rule
the backend applies before it offers desktop sign-in. The origin is saved to
`server.json` in the app config directory
(`~/Library/Application Support/io.wafflebase.desktop/` on macOS) and loaded
directly on later launches. **Use wafflebase.io** in the picker deletes that
file; the official server itself is never saved.

`WAFFLEBASE_DESKTOP_SERVER=<url>` overrides the saved server for one run,
without saving it. It is validated like the picker's input and ignored, with a
message on stderr, when invalid. Against a local `pnpm dev`:

```bash
WAFFLEBASE_DESKTOP_SERVER=http://localhost:5173 pnpm --filter @wafflebase/desktop dev
```

### When the server does not answer

Before the window loads a server (at launch, after picking one, after
cancelling sign-in, and on the picker's Cancel), the shell sends one `GET` to
its `/login` and loads it only once something answers. **Any** HTTP response
counts, a 4xx or 5xx or a redirect included (redirects are not followed); a
server that connects but is slow to answer counts too, and the webview waits
for it. Only a failure to connect does not: no DNS answer, refused, a TLS
failure (a captive portal), or no connection within 8 seconds. Only the
frontend origin is probed, never the backend.

If it does not answer, the window loads the start page once anyway: a Service
Worker from an earlier visit may boot the cached app, which shows its own
offline screen (design doc §10). The shell asks the page whether a worker
controls it; if none does, or nothing committed within 3 seconds, the window
shows `offline.html`: the server's address, a likely cause,
**Try again** and **Change server…**. The shell probes again after 2 s,
doubling to 30 s, and opens the server as soon as it answers; Try again and
the system coming back online (`online` event) probe at once and start the
backoff over. A first probe still running after 1.5 s brings the page up in
its "Connecting…" state, so the window is never blank meanwhile. Leaving the
page, changing server or closing the window stops the probing.

A connection that drops after the server's page has loaded is the web app's
business (its sync-status chip and reconnect), not the shell's. To try the
page, point the app at a port nothing listens on:

```bash
WAFFLEBASE_DESKTOP_SERVER=http://127.0.0.1:59321 pnpm --filter @wafflebase/desktop dev
```

## Links and windows

Links to another site open in the system browser, and so does the docs site
under `/docs` on the server's own origin. Links within the app stay in the
window; ones that ask for a new window open another app window, titled after
the page. The View menu has Back, Forward and Reload, without the browser's
shortcuts, which the editors use (Cmd+[ / Cmd+] indent in Docs, Cmd+R fills
right in Sheets).

## Sign-in

The frontend's sign-in link (`<backend>/auth/github` with no `mode`) is
intercepted, never followed in the window, when the frontend's own `/login`
page follows it in the same window. The same link anywhere else (a hyperlink
in a sheet, a new window) goes to the system browser like any other link:

1. `GET <backend>/auth/providers` must report `desktop.github === true`.
   Without the field the window says the server is too old for desktop
   sign-in; with `false` it says the server has it turned off (no https
   sign-in address, or no `COOKIE_SECURE=true` behind a TLS proxy). On
   Windows `desktop.windowsOrigin === false` also stops it here: that server
   refuses `http://tauri.localhost`, the origin this app's webview hands off
   from, so the sign-in could only fail at the last step.
2. A listener starts on `127.0.0.1:<random>` with a fresh nonce and PKCE
   verifier, and the system browser opens its single-use
   `http://127.0.0.1:<port>/launch/<token>`, which redirects to
   `<backend>/auth/github?mode=desktop&port&nonce&challenge`.
3. On a valid callback the browser tab says "Return to Wafflebase", the app
   window comes to the front and loads `handoff.html`, which takes
   `{ backend, code, verifier, returnTo }` once from the `take_handoff`
   command and POSTs them as a form to `<backend>/auth/desktop/session`. The
   backend sets the session cookies on that response and redirects to the
   frontend, at the sign-in link's `returnTo` path when it carried one.

Starting another sign-in cancels the running one. If the window sign-in
started in was closed meanwhile, the handoff runs in the main window (or any
open one). If the backend's redirect leaves the chosen server (its
`FRONTEND_URL` is another address), the window shows that as the failure.

## Security notes

- **No IPC for the remote origin.** `capabilities/local.json` has no `remote`
  section. In Tauri 2, a request from an origin that is not the app's own
  (`tauri://localhost`, `http(s)://tauri.localhost`) is refused unless a
  capability lists it under `remote.urls`, for app commands as well as plugin
  commands (`Webview::on_message` checks the ACL whenever the origin is not
  local). On top of that, `build.rs` declares an app manifest, so even the
  bundled pages reach only the commands the capability grants. No plugin
  permission is granted to any page: the opener is used from Rust only.
- **Navigation policy** (`navigation.rs`): the frontend origin stays in the
  window, bundled pages are allowed (exactly `tauri://localhost` on macOS and
  Linux, `http://tauri.localhost` on Windows), and every other http(s) origin
  goes to the system browser. New windows to the frontend open as app windows
  with the same policy; others go to the browser. `blob:` documents are
  allowed only when the frontend minted them; `data:`, `file:` and custom
  schemes are refused. The bundled pages are served with
  `frame-ancestors 'none'`, so no page can frame them.
- **Sign-in is taken over only from the login page.** A `/auth/github` link
  starts desktop sign-in only as a same-window navigation from the frontend's
  `/login` route, against the link's origin. Without that rule a
  collaborator's hyperlink to `https://evil.example/auth/github` would run
  sign-in against `evil.example`, which then holds the nonce and could drive
  the loopback callback itself, and would cancel a real sign-in in progress.
  The frontend reaches `/login` by client-side routing, which fires no
  page-load event, so the window's URL is read after the navigation is
  cancelled rather than tracked from page loads. That leaves a narrow race,
  accepted: a foreign link clicked just as the window itself moves to
  `/login` is taken over. The link cannot be required to be on the frontend
  origin, because the backend may have its own (`VITE_BACKEND_API_URL`).
- **The backend origin has to be secure.** A sign-in sends the PKCE verifier
  and the one-time code to the login link's origin, which the server picker
  never saw (it validates the frontend URL). So `is_secure_origin` requires
  `https://`, or `http://` on a loopback literal, the same rule the picker
  applies: a plaintext remote backend's sign-in link goes to the system
  browser instead, and `signin::start` refuses it again before the listener
  opens, so no other caller can start a cleartext exchange.
- **The handoff POST is one-shot.** The only other origin a window may load is
  `<backend>/auth/desktop/session`, once, in the window running the sign-in.
  If that window then finishes loading anything that is neither the frontend
  nor a bundled page (the backend should answer with a redirect to the
  frontend), the sign-in fails and the window shows the error page instead of
  leaving a foreign page on screen without an address bar. When the backend
  shares the frontend's origin, the shell allows that origin anyway, so the
  one-shot rule is the backend's alone: a code redeems once.
- **Loopback listener** (`login.rs`): the CLI's rules unchanged. It binds
  `127.0.0.1` only; the launch link works once, for a `GET` (then `410`; a
  `HEAD` gets `405` and leaves it unspent); `/callback` accepts only `GET`
  with `state` equal to the nonce (constant-time compare), and refuses
  anything else with `403` without ending the wait; a `Host` that is not a
  loopback literal on this port is refused; it gives up after five minutes.
- The PKCE verifier lives in memory and reaches the webview only through the
  one-shot `take_handoff` command, never a URL. The authorization URL never
  reaches a child process's argv: the browser is handed the launch link.
- Downloads go to the Downloads folder under the suggested name, reduced to
  its last path component, with ` (1)`, ` (2)`… added instead of overwriting.

Known limits: on macOS the navigation hook cannot tell a subframe navigation
from a top-level one (wry passes only the URL), so the policy applies to both.
The frontend's only iframes are same-origin. The backend must redirect to the
same frontend origin the app was pointed at (its `FRONTEND_URL`), or the
post-sign-in redirect opens in the system browser.

## Smoke testing

Two debug-build-only hooks let the whole sign-in run without clicking the
window. Both are compiled out of release builds (`#[cfg(debug_assertions)]`).

| Variable | Effect |
|----------|--------|
| `WAFFLEBASE_DESKTOP_BROWSER=<executable>` | The sign-in launch URL is opened by running `<executable> <launch-url>` instead of the system opener. Only the launch URL; external links still use the opener |
| `WAFFLEBASE_DESKTOP_SMOKE_SIGNIN=<backend origin>` | The first time the main window finishes loading the server's frontend, sign-in starts against that backend, through the same code path as an intercepted `/auth/github` navigation |
| `WAFFLEBASE_DESKTOP_SMOKE_SIGNIN=click:<backend origin>` | Exercises the intercept itself: on each frontend load, a script signs out once if a session survived (`POST <backend>/auth/logout`), waits for `/login`, and clicks the page's own GitHub link, so the navigation goes through the same-window `/login` rule |

Debug builds also print one line per step on stderr (`[wafflebase-desktop]`
prefix): navigations and their decisions (without query strings), providers
checked, listener port, callback accepted or refused (with the reason), handoff
page loaded. They never print the nonce, verifier, code or launch token.

Example, with a stand-in browser that follows the redirects:

```bash
cat > /tmp/fake-browser.sh <<'EOF'
#!/bin/sh
exec curl -sS -L -o /dev/null "$1"
EOF
chmod +x /tmp/fake-browser.sh

WAFFLEBASE_DESKTOP_SERVER=http://localhost:5173 \
WAFFLEBASE_DESKTOP_SMOKE_SIGNIN=http://localhost:3000 \
WAFFLEBASE_DESKTOP_BROWSER=/tmp/fake-browser.sh \
  src-tauri/target/debug/bundle/macos/Wafflebase.app/Contents/MacOS/wafflebase-desktop
```

`curl` cannot click the backend's confirmation page, so against a real backend
the stand-in browser has to do that step itself, or point at a fake backend
that redirects straight to the callback.

## Releasing

The app has no release of its own. It carries the repository's version and
ships in the same GitHub release as the server: publishing `vX.Y.Z` runs
`.github/workflows/desktop-release.yml` next to the Docker and npm publishes,
which builds a universal macOS `.dmg` (signed, notarized, stapled), a Windows
NSIS installer (not Authenticode-signed yet) and the updater packages, and
attaches them to that release with `latest.json`. Installed apps poll
`releases/latest/download/latest.json` and install new versions silently when
they quit; download links are:

```
https://github.com/wafflebase/wafflebase/releases/latest/download/Wafflebase_universal.dmg
https://github.com/wafflebase/wafflebase/releases/latest/download/Wafflebase_x64-setup.exe
```

The why is in [desktop-app.md §7](../../docs/design/desktop-app.md#7-release).

### In the release procedure

- The version bump covers `packages/desktop/package.json`,
  `src-tauri/Cargo.toml` and the `wafflebase-desktop` entry in
  `src-tauri/Cargo.lock` (`tauri.conf.json` reads `package.json`).
  `scripts/test/desktop-release.test.mjs` fails until all three match the
  root `package.json`.
- After publishing, approve the `desktop-release` deployment and watch the
  run (about half an hour, mostly notarization). Until it finishes the new release has no installers
  and no `latest.json`; a failure there does not affect the server image.
- Then open the `.dmg` on a Mac that has never run the app: Gatekeeper must
  open it without a warning.

### The `desktop-release` Environment

Deployment branches and tags: `v*` tags only. **Required reviewers: the
maintainers — not optional.** A release runs the workflow file at the tagged
commit, so a tag on a commit that edits the file could drop its agent-App
guard; the Environment's approval is enforced by GitHub whatever the file
says, and its secrets reach no job that skips it. Approve the run after each
release is published.

| Name | Kind | Value |
|------|------|-------|
| `APPLE_CERTIFICATE` | secret | `base64 -i <developer-id>.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | secret | The `.p12` password |
| `APPLE_SIGNING_IDENTITY` | variable | `Developer ID Application: Youngteac Hong (WRGGVTC2RN)` |
| `APPLE_API_KEY_ID` | secret | App Store Connect Team API key ID (role: Developer) |
| `APPLE_API_ISSUER` | secret | Its issuer ID |
| `APPLE_API_KEY_P8` | secret | The `.p8` file's contents |
| `TAURI_SIGNING_PRIVATE_KEY` | secret | The updater minisign private key (file contents) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | secret | Its password |

**The updater key cannot be replaced.** Its public half is compiled into every
installed app, which refuses any package it did not sign. Keep an offline
backup; losing it means every user reinstalls by hand.

**The Developer ID certificate expires yearly** (the current one on
2027-12-26). Before then, issue a new *Developer ID Application* certificate
(G2 Sub-CA) from a CSR whose key never enters a keychain
(`openssl genrsa` + `openssl req -new`), bundle it as a `.p12` with
`openssl pkcs12 -export -legacy` (the runner's `security import` reads the
legacy format), and replace the two `APPLE_CERTIFICATE*` secrets. Apps
already signed keep running: the signature is timestamped.

### Testing an update locally

Build the current version and a higher one against a local manifest, without
touching the shipped endpoint, by merging a config at build time (once with
`"version"` omitted, once with it set). The updater package is off in the base
config, so a plain `build` needs no updater key; releases turn it on with
`src-tauri/tauri.release.conf.json`, and so does this:

```bash
cfg='{"version":"99.0.0","bundle":{"createUpdaterArtifacts":true},"plugins":{"updater":{"endpoints":["http://127.0.0.1:8765/latest.json"],"dangerousInsecureTransportProtocol":true}}}'
TAURI_SIGNING_PRIVATE_KEY=... TAURI_SIGNING_PRIVATE_KEY_PASSWORD=... \
  pnpm --filter @wafflebase/desktop tauri build --bundles app -c "$cfg"
```

Serve the newer `Wafflebase.app.tar.gz` and a `latest.json` naming it from
`127.0.0.1:8765`, then run the older build. It fetches the manifest and the
package at launch without a word; quit it and the bundle on disk is the new
version. **Check for Updates…** instead shows the Restart Now / Later prompt.
