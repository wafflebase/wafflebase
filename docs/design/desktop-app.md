---
title: desktop-app
target-version: 0.7.0
---

# Desktop App

## Summary

A Tauri 2 shell, `packages/desktop`, that opens a team's own Wafflebase
deployment in a native window. The app ships no editor code: it loads the
deployment's frontend from its URL, so the server a team runs decides which
version of Wafflebase they see. Sign-in leaves the window for the system
browser and comes back through the loopback + PKCE flow the CLI already uses
([cli.md](cli.md) §3.1). The returned code is redeemed by a new endpoint that
sets the ordinary session cookies inside the webview. The first release
targets macOS and Windows.

Tauri was chosen over Electron because the web app already edits well in
Safari. The main cost of Tauri, running on WebKit on macOS, is one the
product already pays. In return the app is a fraction of Electron's size, and
the remote origin gets no native API at all by default. The comparison is in
[Alternatives Considered](#alternatives-considered).

### Goals

- Install one app and point it at any Wafflebase deployment. It opens the
  official server by default; a server picker in the app menu switches to any
  other, remembers the choice and can switch back.
- Keep the app independent of server upgrades. The shell carries no frontend
  code, so a self-hosted server upgrading does not need a new app release, and
  an old app keeps working against a new server.
- Sign in with GitHub and Google without loading either provider's login page
  inside the webview.
- Expose no native API (Tauri IPC) to the remote origin.
- Cover the desktop basics: standard menus and shortcuts, remembered window
  state, multiple windows, external links in the system browser, downloads
  saved to disk, single instance, auto-update, signed and notarized builds.
- Release for macOS and Windows.
- Open the app's UI with no network, and say plainly that it is offline,
  rather than showing a blank window (§10).

### Non-Goals

- **Offline reading and editing.** The UI opens offline (§10); documents do
  not. Persisting Yorkie documents locally is deferred in
  [sync-status.md](sync-status.md) and is needed on the web as much as here.
  §10 lays out the follow-ups. Once a document is open, the desktop app
  behaves exactly like a browser tab when the connection drops.
- **Editing local files without a server.** Opening an `.xlsx` and editing it
  in place is a different product from a client for a server.
- **Bundling the frontend into the app.** See Alternatives Considered.
- **Linux in the first release.** WebKitGTK is the weakest of the three
  engines for canvas performance and IME (ibus/fcitx). It is added after it is
  verified on its own.
- **File associations, deep links, `wafflebase://` share links opening in the
  app.** These come after the first release and need a design for routing a
  link to the right server.
- **Mobile.** Tauri 2 supports it, but the web app already has mobile views.

## Proposal Details

### 1. Package layout

```text
packages/desktop/
├── package.json          # @wafflebase/desktop (tauri CLI scripts)
├── src/                  # Bundled pages: picker, sign-in status, handoff, unreachable server
└── src-tauri/
    ├── tauri.conf.json
    ├── capabilities/
    │   └── local.json    # IPC for the bundled pages only
    └── src/
        ├── main.rs
        ├── lib.rs        # Windows, webview hooks, menus, commands
        ├── server.rs     # Server profile: URL validation, persistence
        ├── connection.rs # Reachability probe, retry backoff, offline page (§2)
        ├── navigation.rs # Pure navigation and download decisions (§4)
        ├── signin.rs     # Sign-in state machine (§3)
        └── login.rs      # Loopback listener + PKCE (§3)
```

The webview shows two kinds of content:

| Content | Origin | IPC |
|---------|--------|-----|
| Server picker, sign-in status, handoff page, unreachable-server page | Bundled (`tauri://localhost` on macOS, `http://tauri.localhost` on Windows) | `get_server`, `set_server`, `use_official_server`, `login_status`, `cancel_login`, `take_handoff`, `connection_status`, `retry_connection` |
| The deployment's frontend | The team's server | **None** |

The remote origin is granted no capability. Everything the desktop needs from
it (intercepting sign-in, opening external links, saving downloads) is done
from the native side by watching navigations, so the frontend needs no
desktop-specific code and no `window.__TAURI__` checks.

### 2. Choosing a server

The app opens the official server, `https://wafflebase.io`, until someone
picks another, since that is where most people sign in. A team on its own
deployment uses **Change server…** in the app menu, which opens the bundled
picker. The picker asks for the deployment's URL, the frontend origin users
already visit. The URL must be `https://`, or `http://` on a loopback host for
local development. That is the same rule the backend applies before it offers
CLI sign-in (`cliLoginAvailable()`), and §3 depends on it. The shell saves the
origin as the server profile and loads it; **Use wafflebase.io** deletes the
profile. The official server is never written to the profile, so "no
profile" keeps meaning "the official server" if its address changes. One
server per app instance is enough for the first release; preconfiguring a
server for a managed fleet (MDM) is later work.

The app opens a server at `/login`, not at `/`: signed out, `/` is the
marketing homepage. `/login` sits under the frontend's `PublicRoute`, which
already sent a signed-in visitor on to `/` (and from there into their
workspace), so a signed-in launch lands on their documents on any server. This
release adds only that it honours a same-site `returnTo` first.

The origin chosen here has to be the server's own address, the one its
backend redirects to after sign-in (`FRONTEND_URL`). An alias or a `www.`
variant signs in fine but the backend's final redirect then leaves the app's
origin, goes to the system browser, and the handoff page reports that it was
not sent back.

The backend can be on a different origin from the frontend: the Docker image
is backend-only, and the frontend is built against `VITE_BACKEND_API_URL`. The
shell never needs to be told the backend origin. API calls are `fetch`es,
which the navigation policy does not touch. The one top-level navigation to
the backend, the sign-in link, carries its origin in the URL (§3).

#### When the server does not answer

A webview that cannot load its page shows a blank window and says nothing,
and the shell is not told either: wry 0.57 implements no
`didFailProvisionalNavigation` on WKWebView, so a failed first load fires no
page-load event at all, and on WebView2 it hooks `NavigationCompleted`
without reading `IsSuccess`, so a failure arrives as an ordinary `Finished`.
There is no failure signal to react to, so the shell asks before it loads.
`connection::open` is the one path that sends a window to a server's start
page (launch, `set_server`, `use_official_server`, sign-in cancel, the
picker's Cancel). It sends `GET <origin>/login` from Rust and loads the page
only once that answers.

- **What counts as an answer.** Any HTTP response, whatever its status,
  redirects included and not followed: a self-hosted deployment may answer
  `/login` with anything, a redirect could fail somewhere else and call this
  server down, and what the page then shows is the deployment's business.
  A request that connected and then timed out (15 s) also counts as up: the
  server is slow, and the webview can wait for it longer than the probe
  should. Only connection-level failures mean unreachable: no DNS answer;
  refused; TLS failed, which is what a captive portal intercepting `https://`
  produces; no connection within 8 s; or a connection closed before any
  answer. `connection::verdict` is the pure rule, tested over reqwest's
  `is_connect` / `is_dns` / `is_timeout`, and against real loopback sockets
  for an error status, an unfollowed redirect, a refused port and a server
  that never answers.
- **Only the frontend origin is probed.** The backend may be on another
  origin (above), and it is the frontend that the window loads; a backend
  that is down is the web app's to report.
- **The cached app first.** When the first probe of an attempt fails, the
  window still loads the start page once, since a Service Worker from an
  earlier visit may serve the cached UI (§10), which then handles the outage
  with its own offline screen. The shell decides from page-load events: a
  frontend commit (`PageLoadEvent::Started`) within 3 s, then, once it
  finishes (or after 10 s), `navigator.serviceWorker.controller` read with
  `eval_with_callback`. A controlled document means the cached app booted
  and the shell steps aside. No commit (macOS without a worker fires no
  page-load event at all) or an uncontrolled document (WebView2 commits and
  finishes its own error page under the frontend's URL) means it did not,
  and the offline page follows. Backoff probes and Try again do not repeat
  this. `connection::after_probe` and `after_cached_try` are the pure rules.
- **While it does not answer**, the window shows the bundled `offline.html`:
  the origin, the likely cause in plain words (`navigator.onLine` false
  overrides it), **Try again** and **Change server…**. The shell probes again
  after 2, 4, 8 and 16 s, then every 30 s (Rocket.Chat's desktop schedule),
  and opens the server as soon as it answers. Try again and the page's
  `online` event start a fresh attempt: an immediate probe and the backoff
  from the beginning. A first probe still running after 1.5 s brings the page
  up in its "Connecting…" state, so a slow server never leaves the window
  blank.
- **History stays clean.** At launch the main window is created only once
  the first probe has answered, or failed, or passed 1.5 s, so a reachable
  server is its first page, with no blank or bundled page under it for Back
  to reach. Leaving a loaded offline page for the server uses
  `location.replace`.
- **Stopping.** One attempt runs at a time. A new attempt supersedes the old
  one, and leaving the page, **Change server…** and closing the window stop
  it; a `tokio::sync::Notify` wakes the running probe or backoff sleep, so the
  task ends at once rather than at its next timer.
- **Cost.** One extra request before every server load, so a launch waits a
  round trip (and a TLS handshake) longer before the first byte of the page.
  Offline without a cached app, the offline page appears about 3 s after the
  probe fails rather than at once, the price of giving a worker the chance.
- **After the page has loaded,** a dropped connection is the web app's to
  handle: its sync-status chip and Yorkie's reconnect ([sync-status.md](sync-status.md)).
  The shell neither probes nor takes the window away from a loaded
  frontend, and a failed navigation within it (View → Reload while offline)
  is not caught, for want of the same failure signal.

### 3. Sign-in

The login page renders links to `<backend>/auth/github` and, when configured,
`<backend>/auth/google`. Following them inside the webview is not acceptable:

- Google refuses OAuth in embedded user agents (`disallowed_useragent`).
- GitHub works, but the user types their GitHub password into a window with
  no address bar, and their browser's passkeys and password manager are not
  there.

So the shell intercepts those navigations and runs the login in the system
browser. The first release intercepts GitHub only; Google follows the same
path in Phase 2, and until then a "Continue with Google" link opens in the
system browser like any other backend link. It reuses the CLI's flow and its defenses unchanged, under a new
`mode=desktop`:

```text
Webview navigates to <backend>/auth/github  (no `mode` param)
  │
  ├─ 1. lib.rs cancels it; if it came from the frontend's /login page,
  │     signin.rs starts sign-in against <backend>
  ├─ 2. GET <backend>/auth/providers → must report desktop support
  │     (absent → "too old"; false → desktop sign-in turned off)
  ├─ 3. Loopback listener on 127.0.0.1:<random>; nonce + PKCE verifier
  │     generated and held in memory only
  ├─ 4. System browser opens http://127.0.0.1:<port>/launch/<token>
  │     → <backend>/auth/github?mode=desktop&port&nonce&challenge
  ├─ 5. Confirmation page (CliLoginConfirmMiddleware) → Continue
  ├─ 6. Provider consent → callback → backend redirects to
  │     http://127.0.0.1:<port>/callback?code=…&state=<nonce>
  ├─ 7. login.rs checks nonce, Host and method exactly as the CLI does;
  │     the browser tab says "Return to Wafflebase"
  ├─ 8. Webview loads the bundled handoff page, which top-level POSTs a
  │     form { code, verifier, returnTo } to <backend>/auth/desktop/session
  │     (returnTo is the sign-in link's own, so the user lands where /login
  │     was sending them)
  ├─ 9. Backend consumes code + verifier (CliAuthStore), sets the same
  │     session cookies the OAuth callback sets, 303 → FRONTEND_URL plus
  │     the returnTo path if safeReturnPath accepts it
  └─ 10. The frontend's session check (GET /auth/me) succeeds as in a browser
```

**Why a cookie handoff instead of `POST /auth/cli/exchange`.** The exchange
returns bearer tokens to the caller. The frontend authenticates with httpOnly
cookies in the webview's own cookie store. Getting tokens from the native
process into that store means a different cookie API on each platform
(WKHTTPCookieStore, the WebView2 cookie manager) and a shell that holds
long-lived JWTs. With the handoff page, the response that sets the cookies is
one the webview itself receives, so the shell only ever holds a single-use
code and its verifier.

**Backend changes:**

| Change | Notes |
|--------|-------|
| `mode=desktop` on `GET /auth/github` | Same state, confirmation and nonce machinery as `mode=cli`. Entries in `CliAuthStore` record their mode, so a code minted for one flow cannot be redeemed through the other. The confirmation page names the desktop app instead of the command line |
| `mode=desktop` on `GET /auth/google` (Phase 2) | Google has no CLI mode today ([backend README](../../packages/backend/README.md) `/auth/google`: browser only). The Google guard gains the same state handling |
| `POST /auth/desktop/session` | Form-encoded `{ code, verifier, returnTo? }`, accepted only from a desktop `Origin` (below). Consumes like `cli/exchange`, then writes cookies with the existing `setAuthCookies` path and answers `303` to `FRONTEND_URL` (plus `returnTo` when `safeReturnPath` accepts it). A code that does not redeem answers `303` to `FRONTEND_URL/login?error=desktop_session`. Throttled like `cli/exchange` |
| `GET /auth/providers` | Adds `desktop: { github, google, windowsOrigin }` (`google` is `false` until Phase 2), so a new app can tell an old server apart and say so instead of hanging on the loopback timeout. `windowsOrigin` reports whether `http://tauri.localhost` is still an accepted handoff origin (below); only the Windows app reads it, and it refuses there before opening a browser rather than after the handoff POST is refused |

**The session endpoint only answers the desktop app.** Unlike
`cli/exchange`, which returns tokens to whoever calls it, this endpoint
signs in *the browser that sent the request*. Without a guard, any web page
could auto-submit a form carrying a code and verifier from the attacker's
own unfinished desktop login and sign the visitor's browser into the
attacker's account (login CSRF), after which documents the visitor creates
land in the attacker's workspace. A browser always sends `Origin` on a
cross-site POST and a page cannot forge it, so the endpoint refuses with
`403`, before touching the code, unless `Origin` is one of the webview
origins Tauri serves bundled pages from: `tauri://localhost` (macOS) or
`http://tauri.localhost` (Windows). `https://tauri.localhost`, which Tauri
uses only under `useHttpsScheme`, is not accepted because the app does not
set it. `null` is not accepted, since a sandboxed iframe on any site can
send it. These origins stop web pages, not other Tauri apps (see Risks).

Of the two, only `http://tauri.localhost` is a name a browser can reach, so
`WAFFLEBASE_DESKTOP_WINDOWS_ORIGIN=false` drops it from the allowlist on a
deployment with no Windows desktop users. That costs the Windows app its
in-webview sign-in and nothing else; the default keeps it accepted, since
most deployments would rather have Windows sign-in than close a hole that
needs a hostile local listener (see Risks).

The loopback listener's rules (127.0.0.1 only, single-use `/launch/<token>`,
nonce compared in constant time, `Host` check, `GET` only, five-minute
timeout) are those of [cli.md](cli.md) §3.1 and get no separate design here.
A server on plain `http://` that is not loopback cannot offer desktop sign-in,
for the same reason it cannot offer CLI sign-in. The shell enforces that on
the **backend** origin itself, not only on the frontend the picker validates:
the login link's origin is a separate address (`VITE_BACKEND_API_URL`), and
the sign-in puts the PKCE verifier and the one-time code on it. So
`navigation::is_secure_origin` requires `https://`, or `http://` on a
loopback literal, both in the navigation hook — where a plaintext remote
backend's sign-in link goes to the system browser like any other foreign
one — and again in `signin::start`, the one place that opens the listener.

Sign-out and token refresh need no change: they are the frontend's existing
`POST /auth/logout` and `POST /auth/refresh` calls, made from the webview with
its own cookies.

### 4. Navigation and windows

| Navigation | Action |
|------------|--------|
| Same window, frontend origin | Allow, except the docs site below |
| The documentation site (`/docs`, `/docs/…`) on the frontend origin, same or new window | Cancel, open in the system browser. wafflebase.io serves `packages/documentation` there; it is a website, and a window with no address bar or back button would trap a reader in it |
| `/auth/github` without `mode`, any origin, as a same-window navigation from the frontend's `/login` page | Cancel, run §3 against the link's origin (`/auth/google` joins in Phase 2) |
| The same link from any other page, or as a new window | System browser (a collaborator's hyperlink must not start sign-in against its host) |
| New window (`window.open`, `target=_blank`) to the frontend origin | Open a new app window |
| Any other origin, same or new window | Cancel, open in the system browser |
| Download (`<a download>`) | Saved to Downloads, without a dialog, only for `blob:` URLs the frontend minted or URLs on the frontend origin; anything else is refused. On macOS WebKit routes downloads to this handler before the navigation hook |
| `<backend>/auth/desktop/session` from the handoff page | Allowed once, in the window running sign-in. If that window then renders anything but the frontend or a bundled page, sign-in fails and the window shows the error |

`tauri-plugin-opener` is registered without its link script
(`open_js_links_on_click(false)`). That script catches every `target=_blank`
click, cancels it and asks over IPC to open the URL, but the deployment's
pages get no IPC (§1), so with it on such a link did nothing at all. Off,
WebKit sends the request through `on_new_window` and the table above decides.

The frontend's `window.open` calls are all external hyperlinks in sheets and
docs (`worksheet.ts`, `text-editor.ts`), so the system browser is the right
place for them. Every download goes through one of two helpers,
`downloadDocumentFile` (`api/download-file.ts`) and `downloadBlob`
(`app/docs/export-utils.ts`). Both fetch with credentials and then click an
`<a download>` on an object URL, so no download is a navigation to the backend
that would reach the system browser without cookies.

### 5. Desktop features

- **Menus.** The standard app and Edit menus. On macOS this is functional, not
  cosmetic: without Edit menu items bound to Cmd+C/V/X/Z, those shortcuts never
  reach the webview. Editor shortcuts stay in the page (Google parity). A View
  menu adds **Back**, **Forward** and **Reload**, since the window has no
  toolbar and a page the app offers no way out of would be a dead end. They
  carry no accelerators on purpose: a menu accelerator wins over the page, and
  the browser's Cmd+[ / Cmd+] indent in Docs and Cmd+R fills right in Sheets.
- **Window titles.** A window takes its page's `document.title` (the editors
  set it to the document's name), so windows side by side can be told apart in
  the Window menu, the Dock and Alt+Tab.
- **Plugins.** `window-state`, `single-instance` (a second launch focuses the
  existing window), `updater`, `dialog` (the update prompt), `opener` (system
  browser). `updater` and `dialog` are driven from Rust only; no capability
  grants their commands to any page.
- **Updates.** The app updates only the shell; the UI updates when the server
  does. Because the app ships with every server release (§7), most updates
  change nothing a user would notice, so `src-tauri/src/update.rs` keeps the
  background check silent: at launch and once a day (release builds) it
  downloads a new version, verifies its minisign signature against the public
  key compiled into `tauri.conf.json`, and installs it when the app quits; the
  next launch runs it. Only **Check for Updates…** in the app menu talks to
  the user: "up to date", or **Restart Now** / **Later** (Later leaves it for
  quit). The install at quit runs on `RunEvent::Exit` (macOS's Quit sends
  no `ExitRequested`), on a worker thread the quit waits for at most 30
  seconds: on macOS an install that needs administrator rights hands its
  prompt to the main thread and blocks, so installing on the main thread
  would hang the quit. In that case nothing has been moved yet when it
  blocks, so the quit proceeds with the current app intact; **Restart Now**,
  with the main thread free, is the way to install there. A check is bounded at ten minutes as a
  whole, since the plugin's per-request timeout does not reach the package
  download. On Windows the NSIS installer runs passively and, run at quit,
  does not relaunch the app the user just closed. A failed background check is
  logged, not shown.
- **Signing.** Apple Developer ID (G2 intermediate) with notarization on macOS.
  Windows builds are minisign-signed for the updater but not yet
  Authenticode-signed, so SmartScreen warns on first run until a signing route
  is chosen (Azure Artifact Signing, or an OV certificate in a cloud HSM —
  EV no longer buys SmartScreen reputation). Signing secrets live only in the
  `desktop-release` GitHub Environment, restricted to `v*` tags and gated by
  a required reviewer (§ Risks). The updater package and its `.sig` are
  turned on by `src-tauri/tauri.release.conf.json`, which only the release
  workflow passes, so a local `tauri build` needs no updater key.

### 6. WebKit checklist

Safari editing already works, but WKWebView is not Safari, and the desktop app
puts every macOS user on it. Before Phase 1 these are checked by hand in a
spike, against call sites in the current code:

| Area | Where | What to check |
|------|-------|---------------|
| Clipboard read | `navigator.clipboard.read` in sheets paste (`worksheet.ts`, `spreadsheet.ts`), 12 sites | Rich paste from Excel/Google Sheets works; permission prompts |
| Clipboard write | `ClipboardItem`, `writeText` | Copy to other apps keeps HTML + plain text |
| Fullscreen | `requestFullscreen`, slides presentation mode | Native fullscreen, or the existing overlay fallback ([slides-presentation-mode.md](slides/slides-presentation-mode.md)) |
| Downloads | §4 helpers | `blob:` downloads land with the right filename |
| IME | Docs, sheets, slides text | Korean composition, including the cases covered for Mobile Safari in [docs.md](docs/docs.md) |
| Storage | `localStorage`, IndexedDB | Persist across app restarts, per server origin |
| Fonts | Lazy-loaded Noto KR, slide fonts | Load and measure the same as Safari |
| Sync | Yorkie connection | Reconnects after sleep and network change |

Windows uses WebView2, which is Chromium, and needs only a smoke test.

To keep this from regressing, `test:webkit` (`packages/frontend`) joins CI.
It exists today but no workflow runs it.

### 7. Release

The app carries the repository's lockstep version and ships in the same
GitHub release as the server: publishing `vX.Y.Z` runs `docker-publish.yml`,
`npm-publish.yml` and `.github/workflows/desktop-release.yml` side by side.
The last builds a universal macOS bundle (signed, notarized, stapled; the disk
image notarized separately) and a Windows NSIS installer and attaches them to
that release. It is a separate workflow so that notarization, which waits on
Apple and can fail, never holds up or fails the server image. The secrets it
needs are in [`packages/desktop/README.md`](../../packages/desktop/README.md#releasing).

One version means one number in release notes, bug reports and the About
box, and no second release procedure. It is a release number, not a
compatibility contract: a 0.7.0 app opens a self-hosted 0.6.x server like any
other, and what a server supports is read from `/auth/providers` (§3).
`scripts/test/desktop-release.test.mjs` keeps `packages/desktop/package.json`,
`Cargo.toml` and `Cargo.lock` on the root version, so a release bump that
misses them fails before the tag; the workflow's first job checks the tag
again.

An earlier draft gave the app its own `desktop-v*` tags. That would have
needed its own release procedure, and since server releases own the
repository's "Latest", its update manifest a rolling release of its own. The
cost of riding the server's release is cadence: the app ships with every
server release, most of which do not touch the shell, which is why the
background update is silent.

Distribution is GitHub Releases only. The Mac App Store would require the
sandbox, under which the loopback sign-in listener and direct writes to
Downloads need entitlements and review for what is a thin shell; the
Microsoft Store adds a review cycle for no capability the installer lacks.
Homebrew and winget manifests can point at the same assets later.

**Where the manifest lives.** Every release carries the update manifest, latest.json, and
installers under stable names (`Wafflebase_universal.dmg`,
`Wafflebase_x64-setup.exe`), so the app polls
<https://github.com/wafflebase/wafflebase/releases/latest/download/latest.json> and download links use
`releases/latest/download/<name>`. The endpoint is compiled into every
installed app and cannot move without a manual reinstall; a unit test pins
it. The manifest's package URLs name the release's own tag, never `latest`,
so a download in flight cannot change under the app. A prerelease is never
"Latest", so it is never offered.

The manifest is uploaded last. Between publishing a release and the end of
the desktop run (about half an hour, mostly notarization) the new "Latest"
has no manifest or installers: update checks get a 404 and try again the
next day, and download links are briefly dead. If the run fails for good,
installed apps stay where they are until the next release.

**Keys that cannot be lost.**

| Key | Where | If lost |
|-----|-------|---------|
| Updater minisign private key | `TAURI_SIGNING_PRIVATE_KEY` secret + offline backup | Every installed app refuses every future update; users must reinstall by hand. Its public key is in `tauri.conf.json` |
| Developer ID Application certificate | `APPLE_CERTIFICATE` secret + offline backup | Reissue; nothing breaks. Apps signed with a timestamp keep running after it expires |

The certificate issued for the first release expires 2027-12-26. Newly
issued Developer ID certificates are valid for about 13 months, so renewal is
a yearly step in the README procedure.

### 8. Rollout

| Phase | Scope |
|-------|-------|
| 0. Spike | Unsigned shell that loads a deployment; run the §6 checklist on macOS. Go or no-go for Tauri |
| 1. Sign-in | Backend `mode=desktop` (GitHub), `/auth/desktop/session`, providers field. Shell: picker, navigation policy, login, downloads, menus. Unsigned macOS + Windows builds for the team |
| 2. Release | Google `mode=desktop`; signing, notarization, updater, released with the server (shipped: `desktop-release.yml`, `update.rs`); Authenticode; `test:webkit` in CI; public release |
| Later | Linux; file associations into import; deep links; offline reading and editing (§10 follow-ups) |

### 9. What the Phase 0 spike found

Measured on macOS with Tauri 2.12.7 (wry 0.57.3), running the real app
against a local backend whose GitHub endpoints pointed at a fake OAuth server:

- **The handoff works on WebKit.** The cross-site form POST from
  `tauri://localhost` arrives with `Origin: tauri://localhost`. The cookies set
  on its `303` are kept, the frontend's next requests carry them, and they
  survive an app restart. The tracking-prevention risk below did not show up
  with the frontend and backend on the same site. It is still untested with
  the two on different sites.
- **The handoff page must not set `no-referrer`.** With
  `<meta name="referrer" content="no-referrer">`, WebKit sends `Origin: null`
  on the POST, as the Fetch spec requires, and the backend correctly refuses
  it. `handoff.html` carries a comment saying so.
- **`on_navigation` fires for the initial load, and for subframes too.** On
  macOS, wry passes only the URL, so the policy cannot tell a subframe from a
  top-level navigation. That is safe today because the frontend only embeds
  same-origin iframes. It has to be revisited if a cross-origin embed is ever
  added. On Windows the opposite holds: wry's WebView2 backend hooks
  `NavigationStarting`, which is top-level only, so subframe navigations are
  not checked at all. Neither gives a frame IPC, and `frame-ancestors 'none'`
  keeps bundled pages from being framed.
- **The remote origin really has no IPC.** A script on the deployment calling
  the shell's own commands and `plugin:opener|open_url` was refused by the ACL
  for each one. `withGlobalTauri` still exposes an inert `window.__TAURI__`
  object to remote pages.

### 10. Offline boot

Launched with no network, the app used to show an empty window: it loads the
deployment's frontend from its URL (§1), and there was nothing to load. Slack's
desktop app answers this with a Service Worker that caches its UI, and so does
this app. The worker belongs to the **frontend**, not the shell, so it keeps
§1's property: the shell carries no frontend code, and the UI a user sees
offline is the one their server last served. For now the frontend registers it
only inside the desktop app, which it recognizes by a marker the shell injects
into every page (`window.__WAFFLEBASE_DESKTOP__`, carrying the app version);
that is the one place the frontend knows it runs in the app, and it decides
nothing but whether the worker is registered. The frontend design is in [frontend.md](frontend.md) § Offline app
shell.

**Spike: Service Workers work in the shell's WKWebView.** Measured on macOS 26
(Darwin 25.3) with Tauri 2.12.7 / wry 0.57.3, running the debug shell against
`http://localhost` (a secure context, like any `https://` deployment):

- wry gives each window `WKWebsiteDataStore.defaultDataStore` (persistent; the
  app sets no `incognito` and no data-store identifier), and sets
  `limitsNavigationsToAppBoundDomains` on iOS only. App-Bound Domains, which
  gate Service Workers in a third-party WKWebView on iOS, do not apply on
  macOS.
- A test page reported `'serviceWorker' in navigator`, registered /sw.js,
  reached `ready` and got `controllerchange` within 120 ms of first load.
- After quitting the app and **stopping the server**, a relaunch loaded the
  page with `navigator.serviceWorker.controller` set, `workerStart > 0` in its
  navigation timing, and the precached Cache Storage entry present: the worker
  served it, and both the registration and the cache survived the restart.
- The real frontend build did the same: offline, `/login` rendered the offline
  screen with the page controlled by `sw.js`. The Chromium equivalent (the
  WebView2 engine) did too for `/login` and for a signed-in deep link never
  visited before, which is what precaching `PrivateRoute` is for.
- With no worker registered and the server down, the shell logs the
  navigation (`navigation … -> Allow`) and **no** page-load event follows.
  With the worker, `PageLoadEvent::Finished` fires for the frontend URL as for
  any load. Windows was not run; WebView2 is Chromium and supports Service
  Workers for `https://` origins, but see below on its page-load event.

**What works offline, and what does not.**

| | Offline |
|-|---------|
| Launch, window, menus, **Change server…** | Yes, as before |
| The app's UI at `/login` or any signed-in route | Yes, from the worker's cache, showing the offline screen ("You're offline", documents are on the server, Try again; retries on the browser's `online` event) |
| A route opened once online (an editor's chunk) | Its code is cached, but it sits behind the session check, so it shows the same screen |
| Document list, documents, sign-in | No: they need the API and Yorkie, which are not cached and must not be |
| A server never opened online, or a first launch | No worker yet: what the unreachable-server page (below) is for |

The offline screen makes no claim that anything is saved or available locally.
The same rule as [sync-status.md](sync-status.md), for the same reason.

**With the unreachable-server page.** The shell's bundled failure page (probe
before load, backoff, Retry / Change server) and this cached UI answer the same
condition, and the cached UI should win when it exists, since it is the user's
own app and recovers in place. The shell cannot ask the remote origin anything
over IPC, and should not learn to, but it does not need to:

1. Probe as planned. When the server answers, load it; nothing changes.
2. When the probe fails, **navigate to the server's start URL anyway** rather
   than straight to the bundled page.
3. On `PageLoadEvent::Finished` for the frontend origin, ask the page whether
   a worker served it:
   `window.eval_with_callback("!!(navigator.serviceWorker && navigator.serviceWorker.controller)", …)`.
   `true`: the cached UI booted; stop, and leave recovery to the page's own
   Try again and `online` handling. `false`: show the bundled page.
4. No frontend commit (`PageLoadEvent::Started`) within 3 s (macOS with no
   worker fires no page-load event at all, measured above): show the bundled
   page. Once a commit arrives the shell waits for `Finished` up to 10 s, so a
   cached app booting slowly on a busy machine is not navigated away mid-boot
   (§2 "When the server does not answer" has the implemented rule).

Step 3's check is needed on Windows, where wry fires `Finished` on WebView2's
`NavigationCompleted` whether or not the navigation succeeded, so an error page
would otherwise look like a booted app. Only the shell evaluates script, and
the page cannot start anything. A page that lies only stops the shell from
replacing it. `eval_with_callback` was run against the offline frontend in the
spike and returned the expected value. The unreachable-server work implements
it in `connection.rs` (`after_probe`, `after_cached_try`).

**Follow-ups: reading and editing offline.** Each is a separate design, in
this order:

1. **Read a recently opened document.** The worker must keep storing no API
   response or document content, because its cache is shared by everyone who
   uses this browser profile and is not cleared on sign-out. A read-only copy
   would therefore come from the editor: a Yorkie snapshot (`Document.toBytes()`)
   written to IndexedDB when a document is opened, keyed by user and document,
   cleared on sign-out, with a small recent-documents index the offline screen
   lists. It renders through the existing read-only `Mem*Store` path that
   revision previews already use ([revision-history.md](revision-history.md)).
   It needs a cached signed-in identity, since `/auth/me` is unreachable, and
   an answer to whether a copy of a document the user has since lost access to
   may still be shown.
2. **Edit offline.** This is Yorkie's `ClientOptions.store` and the
   stable-`clientKey` trade described in [sync-status.md](sync-status.md)
   § Non-Goals: a stable key brings the SDK's single-active-session guard,
   which refuses a second window on the same document. The desktop app makes
   that trade more pressing, not different: it opens documents in several
   windows of one webview profile.

### Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| WKWebView differs from Safari (clipboard, downloads, fullscreen) | §6 spike before Phase 1. The shell is small, so falling back to Electron costs little until Phase 1 lands |
| WebKit regressions reach desktop users unnoticed | `test:webkit` in CI (Phase 2) |
| The server is unreachable and the webview reports no failure (§2) | Probe before every load, bundled offline page with backoff retry. A probe can still disagree with the webview (a proxy or certificate setting only one of them honours); a false "unreachable" keeps retrying and Change server… is always on the page, a false "reachable" is the old blank window |
| App and self-hosted server versions drift | No frontend in the app; `desktop` field in `/auth/providers` turns an old server into a clear message, not a timeout |
| WebView tracking prevention drops the cookies set by the cross-site handoff POST | Verified in the spike. Fallback: write the cookies through each platform's native cookie store |
| A loopback listener is reachable by local pages and processes | Same nonce, `Host` and single-use rules as the CLI, reviewed there |
| Remote content reaching native APIs | No capability for remote origins; all native behavior is driven from navigation events |
| Signing certificates and their cost | Secrets scoped to the `desktop-release` Environment, restricted to `v*` tags; Phase 1 builds are unsigned and internal |
| The agent App can publish a release (`contents: write`), and a release runs the workflow file at the tagged commit, so a tag on a commit that edits the file could drop its guard | The first job refuses a release the App authored and every job reading a secret depends on it (`release-guard.test.mjs`), as in the server's publish workflows. That guard is in the file, so the backstop is the Environment: its secrets reach only a job that names it, and a **required reviewer** makes every such job wait for a maintainer whatever the file says |
| The manifest names an asset the release does not carry | Every installed app logs a 404 and nobody sees it. `desktop-release.test.mjs` checks that the names agree across the Collect steps, the manifest, the upload and the README's download links |
| A cached UI keeps users on an old build after a deploy | Navigations are network-first: the cache answers only when the server cannot. A deploy changes `sw.js`, and the new worker replaces the old shell and prunes old chunks ([frontend.md](frontend.md) § Offline app shell). `VITE_SERVICE_WORKER=off` turns it off and unregisters it |
| Every server release ships the app, most without shell changes | Silent background update, installed on quit (§5); one ~10 MB download per release |
| The updater key leaks | An attacker who can also serve the manifest could ship a signed update. The manifest is on GitHub Releases, writable only by the repository; rotating the key requires a release that trusts both keys before the old one is dropped |
| Deployments on plain `http://` cannot sign in | Same constraint as CLI sign-in; the picker says so when validating the frontend URL, and `navigation::is_secure_origin` applies the same rule to the backend origin the login link names, so no exchange runs over cleartext |
| The window's URL is read after a `/auth/github` navigation is cancelled (client-side routing to `/login` fires no event), so a foreign sign-in link clicked just as the window itself moves to `/login` is taken over against the foreign origin | Accepted. The race needs the click and an app-driven route change within one main-thread turn. The foreign backend then holds that attempt's nonce, so it can cancel a real sign-in in progress or finish the attempt against itself, but its OAuth page opens in the system browser with an address bar, and its session POST sets no cookie on the chosen server. Requiring the link to be on the frontend origin is not an option: the backend may have its own (`VITE_BACKEND_API_URL`). Pinning the backend origin after the first sign-in is the follow-up if this needs closing |
| Every Tauri app on the machine serves its bundled pages from the same origins (`tauri://localhost`, `http://tauri.localhost`), so another installed Tauri app, or one that renders untrusted HTML in its bundled origin, can POST an attacker's code with an allowed `Origin` (login CSRF) | Accepted. It needs a hostile or vulnerable app already on the machine. Tauri offers no per-app origin to check instead; binding the code to the app would need a secret the app holds and a page cannot read, which is a larger change than this risk warrants today |
| `http://tauri.localhost` is reachable from an ordinary browser in more than one way: Chrome and Firefox resolve RFC 6761 `*.localhost` to loopback, so a process already listening on the user's port 80 could serve a page with an allowed `Origin`; and `tauri.localhost` is also a real DNS name, so a browser that does not special-case `.localhost`, or a resolver that answers for it, can be pointed at a remote page that produces the origin | Accepted by default, because dropping it costs Windows users their sign-in. `WAFFLEBASE_DESKTOP_WINDOWS_ORIGIN=false` is the per-deployment opt-out; macOS and Linux keep theirs on `tauri://localhost`, which no browser can produce at all. The residual risk is a login CSRF, bounded by the code's 5-minute single-use lifetime |
| A `mode=cli` or `mode=desktop` start that another site navigated the browser into is answered with the confirmation page, not refused. `CliLoginConfirmMiddleware` runs before the guard's `Sec-Fetch-Site` check, which therefore only ever sees the same-origin Continue click. This is inherited from the CLI flow | The confirmation click remains the gate. Enforcing the check in the middleware is a follow-up: first confirm what `Sec-Fetch-Site` browsers report after the loopback `/launch` redirect, so the fix does not refuse genuine sign-ins |

## Alternatives Considered

| Alternative | Why not |
|-------------|---------|
| Electron | Same Chromium everywhere, the closest match to the Chromium-only visual tests. Rejected because the web app already works in Safari, so its main advantage buys little, while it costs ~100 MB per install, more memory and security defaults that must be set by hand. It stays the fallback if the §6 spike fails |
| Installable PWA | No control over sign-in, downloads, menus or updates, and it depends on the user's browser (Safari and Firefox install support differs). Adding a web manifest is cheap and worth doing on its own, but it is not this app |
| Bundle the frontend into the app | Every server upgrade would need an app release, and a team on an older server would get a frontend newer than its API |
| A shell-level copy of the last frontend, served offline through a custom protocol | Considered for §10 in case Service Workers did not work in WKWebView; they do. It would need the shell to fetch and store a remote bundle, and serving it from a bundled origin puts the deployment's code where `capabilities/local.json` grants IPC, the one property §1 rules out |
| Custom URL scheme (`wafflebase://`) for the OAuth callback | Any other app can register the same scheme. Loopback + PKCE is the RFC 8252 recommendation, and the CLI already has it |
| `cli/exchange` tokens injected as cookies from native code | Per-platform cookie APIs, and the shell would hold long-lived JWTs (§3) |
| OAuth inside the webview | Google refuses embedded user agents; GitHub sign-in without an address bar looks like phishing |
