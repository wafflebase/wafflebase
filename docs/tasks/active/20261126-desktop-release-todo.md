# Desktop release: signing, notarization, updater

Phase 2 of [desktop-app.md](../../design/desktop-app.md) §8, release half:
ship signed, notarized macOS builds and an in-app updater with every server
release. Google desktop sign-in and `test:webkit` in CI are the
other half of Phase 2 and are not in this task.

## Decisions

- Channel: GitHub Releases only. No Mac App Store / Microsoft Store (sandbox
  breaks the loopback listener and Downloads writes; review cycle for a shell).
- **One version, one release** (maintainer's call, 2026-11-26). The app takes
  the repository's lockstep version and is attached to the server's own
  `vX.Y.Z` release by a separate workflow on `release: published`, so a
  notarization failure never touches the Docker image. That release is
  "Latest", so the updater uses `releases/latest/download/latest.json`
  (compiled in; pinned by a test). First draft used `desktop-v*` tags and a
  rolling `desktop-latest` release; dropped with this decision.
- **Silent background updates.** Releases are frequent and rarely touch the
  shell, so the background check downloads and installs on quit without a
  prompt; only "Check for Updates…" asks Restart Now / Later.
- macOS: Developer ID Application (G2), individual team `WRGGVTC2RN`. The
  certificate issued 2026-11-26 expires **2027-12-26**; renew yearly.
  Notarization through an App Store Connect Team API key.
- Windows: NSIS, **unsigned** until the Authenticode route (Azure Artifact
  Signing vs OV + cloud HSM) is chosen. The updater payload is still
  minisign-signed.
- **First public release is macOS-only** (maintainer's call, 2026-11-27).
  An unsigned installer greets every new Windows user with SmartScreen, so
  Windows is neither shipped nor advertised yet: the `windows` release job,
  its `windows-x86_64` manifest entry and every Windows download link are
  gone; `verify-desktop (Windows)` keeps the build compiling. Re-add the job
  and links when Authenticode is decided (desktop-app.md §7).
- Updater key: Tauri minisign key; losing it strands every install.
- Signing secrets live only in the `desktop-release` GitHub Environment
  (`v*` tags). The workflow refuses a release the agent App authored, as
  the Docker/npm publishes do.

## Todo

- [x] Developer ID Application (G2) certificate + `.p12` (key generated off-keychain)
- [x] Updater minisign key pair
- [x] `tauri-plugin-updater` + `tauri-plugin-dialog`: silent background check
      (launch + daily, release builds) installed on quit; "Check for
      Updates…" asks Restart Now / Later
- [x] ~~Endpoint env override~~ — not needed: a test build merges
      `-c '{"plugins":{"updater":{...}}}'`, so the shipped binary has no knob
- [x] Single version source (`tauri.conf.json` reads `package.json`); desktop
      joins the lockstep version (0.6.18), `scripts/test/desktop-release.test.mjs`
- [x] `.github/workflows/desktop-release.yml` on `release: published`: macOS
      universal (signed + notarized) + Windows NSIS, attached to the release,
      `latest.json` last
- [x] Docs: desktop-app.md §5/§7, desktop README release procedure
- [x] Verify: cargo fmt/clippy/test; local signed universal build;
      local 0.1.0 → 0.1.1 update against a local manifest
- [x] Default to the official server (`https://wafflebase.io`, never
      saved), picker via "Change server…" with "Use wafflebase.io"; open every
      server at `/login`, which now sends a signed-in visitor on to the app
- [x] Usability pass (impeccable): docs site → system browser; login
      page's Docs link was a client-side `<Link>` to an unrouted `/docs`
      (blank page, web too) → real link; window title follows the page;
      View menu Back / Forward / Reload without accelerators; `target=_blank`
      links did nothing (opener's injected link script needs IPC the page
      does not have) → script off, policy decides; verified by a user click
- [x] ① Unreachable-server view (Rocket.Chat-style): bundled failure page,
      backoff probe (2s → 30s), auto-reload on recovery, Retry / Change server
      — `connection.rs` + `offline.html`; probe-before-load because wry gives
      no load-failure signal (design §2 "When the server does not answer");
      verified by a debug build against a dead then revived loopback port
- [x] ② Offline boot, first slice (Slack-style asset cache): verify Service
      Worker support in WKWebView/Tauri, then make the app open its UI with no
      network; recent-document read-only only if it lands cleanly, else design
      → SW works in WKWebView (spike, desktop-app.md §10); frontend
      `service-worker/sw.js` (network-first shell, hashed assets cache-first,
      no API/data) + offline screen in both route guards; verified offline in
      the real shell and in Chromium. Recent-document read-only **not built**:
      designed as a §10 follow-up (needs an IndexedDB snapshot store, not the
      SW cache). Shell side (probe fails → still navigate, ask the page
      whether a worker served it) is specified in §10 for ①
- [x] Before shipping 0.6.19: production backend must carry desktop sign-in
      (`/auth/providers` has no `desktop` field on 0.6.18), or the default
      server answers "too old". Done: v0.6.19 is live and `/auth/providers`
      carries `desktop` (2026-11-27)
- [x] User: App Store Connect API access + Team key; Environment secrets;
      first server release that carries the app (v0.6.19, notarized first
      time, run 45974371862)
- [x] macOS-only first release: drop the Windows job/manifest key/upload,
      pin the macOS-only set in `desktop-release.test.mjs`, homepage offers
      only the Mac build ("Windows and Linux versions are coming" elsewhere),
      docs/README/design docs say macOS only for now
- [ ] When Authenticode is chosen: sign in a `windows` release job, restore
      the `windows-x86_64` manifest entry, upload and download links

## Review

Verified locally (2026-11-26):

- `cargo fmt --check`, `clippy -D warnings`, `cargo test` (55, incl. the
  endpoint pin) on 1.90; `pnpm verify:fast` green; actionlint and the
  workflow guard tests (`trusted-cache`, `release-guard`, `ci-workflow`) pass
  on `desktop-release.yml`.
- Universal (`x86_64 arm64`) release builds of 0.1.0 and 0.1.1, signed with
  the new Developer ID (hardened runtime, Apple timestamp,
  `codesign --verify --deep --strict` clean). `spctl` says "Unnotarized
  Developer ID", as expected without the API key.
- Updater against a local manifest (test-only `-c` config): 0.1.0 at launch
  fetched `latest.json` and the package; quitting installed it (bundle became
  0.1.1, signature intact); 0.1.1 at launch fetched only the manifest; a
  manifest carrying the wrong minisign signature was downloaded but never
  installed (bundle stayed 0.1.0).

After the switch to one release + silent updates: `cargo test` (55, endpoint
now `releases/latest`), all of `scripts/test` (incl. `release-guard` over the
new `release: published` trigger and `desktop-release`), actionlint,
`verify:fast`. Re-ran the updater (arm64, test config): a 0.6.18 build
fetched the manifest and a 99.0.0 package at launch and, on quit, the bundle
on disk was 99.0.0.

After self-review round 3 (exit path moved to a worker thread): a 0.6.18
build quit by Apple Event installed 99.0.0; with the install directory made
read-only (the plugin's admin-rights path), the quit finished after the
30-second wait, logged "left for the next launch", and the app stayed
0.6.18.

Not verified here: that no dialog appears on the silent path, and the
manual-check dialog itself (no screen capture permission in this
session) and Restart Now; tauri's own `APPLE_CERTIFICATE` signing path,
notarization and the Windows job, which only the first release run exercises.
