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

- Install one app and point it at any Wafflebase deployment. A server picker
  runs on first launch, remembers the choice and can switch later.
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

### Non-Goals

- **Offline editing.** Persisting Yorkie documents locally is deferred in
  [sync-status.md](sync-status.md) and is needed on the web as much as here.
  It gets its own design. The desktop app behaves exactly like a browser tab
  when the connection drops.
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
├── src/                  # Bundled pages: picker, sign-in status, handoff
└── src-tauri/
    ├── tauri.conf.json
    ├── capabilities/
    │   └── local.json    # IPC for the bundled pages only
    └── src/
        ├── main.rs
        ├── lib.rs        # Windows, webview hooks, menus, commands
        ├── server.rs     # Server profile: URL validation, persistence
        ├── navigation.rs # Pure navigation and download decisions (§4)
        ├── signin.rs     # Sign-in state machine (§3)
        └── login.rs      # Loopback listener + PKCE (§3)
```

The webview shows two kinds of content:

| Content | Origin | IPC |
|---------|--------|-----|
| Server picker, sign-in status, handoff page | Bundled (`tauri://localhost` on macOS, `http://tauri.localhost` on Windows) | `get_server`, `set_server`, `login_status`, `cancel_login`, `take_handoff` |
| The deployment's frontend | The team's server | **None** |

The remote origin is granted no capability. Everything the desktop needs from
it (intercepting sign-in, opening external links, saving downloads) is done
from the native side by watching navigations, so the frontend needs no
desktop-specific code and no `window.__TAURI__` checks.

### 2. Choosing a server

On first launch the bundled picker asks for the deployment's URL, which is the
frontend origin users already visit. The URL must be `https://`, or `http://`
on a loopback host for local development. That is the same rule the backend
applies before it offers CLI sign-in (`cliLoginAvailable()`), and §3 depends
on it. The shell saves the origin as the server profile and loads it. A
"Change server…" menu item returns to the picker. One server per app instance
is enough for the first release.

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
| Same window, frontend origin | Allow |
| `/auth/github` without `mode`, any origin, as a same-window navigation from the frontend's `/login` page | Cancel, run §3 against the link's origin (`/auth/google` joins in Phase 2) |
| The same link from any other page, or as a new window | System browser (a collaborator's hyperlink must not start sign-in against its host) |
| New window (`window.open`, `target=_blank`) to the frontend origin | Open a new app window |
| Any other origin, same or new window | Cancel, open in the system browser |
| Download (`<a download>`) | Saved to Downloads, without a dialog, only for `blob:` URLs the frontend minted or URLs on the frontend origin; anything else is refused. On macOS WebKit routes downloads to this handler before the navigation hook |
| `<backend>/auth/desktop/session` from the handoff page | Allowed once, in the window running sign-in. If that window then renders anything but the frontend or a bundled page, sign-in fails and the window shows the error |

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
  reach the webview. Editor shortcuts stay in the page (Google parity).
- **Plugins.** `window-state`, `single-instance` (a second launch focuses the
  existing window), `updater`, `opener` (system browser).
- **Updates.** Signed update manifests published with GitHub Releases. The
  app updates only the shell. The UI updates when the server does.
- **Signing.** Apple Developer ID with notarization on macOS, Authenticode on
  Windows. Signing secrets are used only by tag-triggered release jobs.

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

`@wafflebase/desktop` has its own version and `desktop-v*` tags, separate from
the server's lockstep version, because it carries no server or frontend code.
A release job builds a universal macOS bundle and a Windows installer, signs
them and publishes them to GitHub Releases with the update manifest. The
desktop release is not a step in the server release procedure.

### 8. Rollout

| Phase | Scope |
|-------|-------|
| 0. Spike | Unsigned shell that loads a deployment; run the §6 checklist on macOS. Go or no-go for Tauri |
| 1. Sign-in | Backend `mode=desktop` (GitHub), `/auth/desktop/session`, providers field. Shell: picker, navigation policy, login, downloads, menus. Unsigned macOS + Windows builds for the team |
| 2. Release | Google `mode=desktop`; signing, notarization, updater; `test:webkit` in CI; public release |
| Later | Linux; file associations into import; deep links; offline (separate design) |

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

### Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| WKWebView differs from Safari (clipboard, downloads, fullscreen) | §6 spike before Phase 1. The shell is small, so falling back to Electron costs little until Phase 1 lands |
| WebKit regressions reach desktop users unnoticed | `test:webkit` in CI (Phase 2) |
| App and self-hosted server versions drift | No frontend in the app; `desktop` field in `/auth/providers` turns an old server into a clear message, not a timeout |
| WebView tracking prevention drops the cookies set by the cross-site handoff POST | Verified in the spike. Fallback: write the cookies through each platform's native cookie store |
| A loopback listener is reachable by local pages and processes | Same nonce, `Host` and single-use rules as the CLI, reviewed there |
| Remote content reaching native APIs | No capability for remote origins; all native behavior is driven from navigation events |
| Signing certificates and their cost | Secrets scoped to tag-triggered jobs; Phase 1 builds are unsigned and internal |
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
| Custom URL scheme (`wafflebase://`) for the OAuth callback | Any other app can register the same scheme. Loopback + PKCE is the RFC 8252 recommendation, and the CLI already has it |
| `cli/exchange` tokens injected as cookies from native code | Per-platform cookie APIs, and the shell would hold long-lived JWTs (§3) |
| OAuth inside the webview | Google refuses embedded user agents; GitHub sign-in without an address bar looks like phishing |
