# Desktop release — lessons

- **`releases/latest` belongs to the server.** This repository publishes server
  releases as "Latest", so the Tauri-docs default endpoint
  (`releases/latest/download/latest.json`) would 404 for every installed app.
  The endpoint is compiled in; a unit test now pins it to `desktop-latest`.
- **Tauri's `APPLE_CERTIFICATE` path matches the signing identity by name.**
  With a same-named older certificate in the login keychain, codesign reports
  the name as ambiguous, and passing the SHA-1 instead is refused ("does not
  match provided identity"). Only a developer machine hits this; the CI runner
  has one certificate. Local signed builds sign with `codesign --keychain`
  from a throwaway keychain instead.
- **`openssl verify` fails Developer ID certificates with "unhandled critical
  extension"** (Apple's marker OIDs). `-ignore_critical` is the right flag;
  the real proof is a `codesign --timestamp` that shows the full chain.
- **New Developer ID certificates are valid ~13 months** (issued 2026-11-26,
  expires 2027-12-26), not the five years older ones had. Renewal is yearly.
- **Generate the signing key off-keychain.** `openssl genrsa` + CSR, then
  `pkcs12 -export -legacy`: the key exists only in the `.p12`, so "which Mac
  holds the private key" cannot recur.
- **Versioning follows the release process, not the code boundary.** The
  first draft gave the shell its own `desktop-v*` version because it carries
  no server code — correct, and still the wrong call: a second number and a
  second procedure cost more than the extra updates, and riding the server's
  release made the "Latest" problem disappear. What the separate version was
  protecting (no update nags) is better bought in the update UX (silent,
  installed on quit).

## Self-review

- **Round 1** (security / blast-radius / design-fit did not run: HTTP 429
  usage limit — not a clean result). Correctness: "Check for Updates…" was
  silent while the launch check ran (`busy` early return) — fixed: a manual
  request joins the running check, state under one mutex so the join cannot
  race the finish; decisions pulled into pure `begin`/`tell` with tests. `jq
  --rawfile` would carry a `.sig` trailing newline into the manifest — fixed
  via `$(cat …)` (local e2e used `$(cat …)`, which is why it passed). Also
  fixed the minors: failed Restart Now keeps the package, `lipo -verify_arch`
  instead of grepping `-archs` order, explicit `codesign --verify` on the
  `.dmg`, `createUpdaterArtifacts` pinned, and the workflow comment that
  called the 404 window "no update" (it is a logged failure, retried daily).
  Test-adequacy "update.rs untested" — addressed by the pure decision
  functions; the Tauri glue stays covered by the local e2e only.
- **Round 2** (all six lenses ran; docs + design-fit clean). Correctness: no
  request timeout, so a stalled fetch latched `busy` for the session — fixed
  (5-minute per-request timeout via `updater_builder`). Test-adequacy: nothing
  tied manifest URLs to uploaded assets — fixed: `desktop-release.test.mjs`
  (renamed from `desktop-version`) checks Collect → manifest → upload →
  README links and the release overlay on both builds; mutation-checked.
  Security: a `release` runs the workflow at the tagged commit, so the
  in-file App guard can be edited away — agreed; the Environment's required
  reviewer is now mandatory in the docs, not optional (it binds whatever the
  file says). Blast-radius: `createUpdaterArtifacts: true` broke a local
  `tauri build` without the updater key — fixed: moved to
  `tauri.release.conf.json`, passed only by the workflow.
- **Round 3** (last; blast-radius, design-fit, docs clean). Correctness: the
  round-2 timeout was set on the updater builder, which the plugin does not
  pass on to `Update::download` (`timeout: None`, updater.rs:735) — fixed by
  bounding the whole fetch with `tokio::time::timeout`. Same lens: installing
  from `RunEvent::Exit` runs on the main thread, and the plugin's macOS
  admin-rights path posts to the main thread and blocks (updater.rs:1594) —
  a hang on quit. First fix (hold `ExitRequested`, install on a worker,
  then exit) passed the unit tests and failed the e2e: macOS's Quit (Apple
  Event `quit`, like Cmd+Q) sends no `ExitRequested`, so nothing installed.
  Final fix: stay on `Exit`, install on a worker, wait at most 30 s; in the
  admin case the plugin has moved nothing when it blocks (the atomic swap
  failed with EPERM), so the quit proceeds intact. Restart Now installs off
  the dialog thread. Lesson: re-run the e2e after every lifecycle change.
  Deferred, as PR known limitations: test-adequacy "check() wiring untested"
  (needs a Tauri mock runtime; covered by the local e2e), and security "the
  Environment's required reviewer cannot be verified from the repo" (a
  repository setting; an in-workflow check could be edited away by the same
  tagged commit it is meant to stop). Minor, left: no RAII guard on `busy`
  if `fetch` panics; an Offer racing a quit can show no dialog.
- **Read the dependency, not its docs, before trusting a knob.** Both round-3
  bugs were in plugin internals the API surface hides: a builder timeout that
  the returned `Update` drops, and an install that blocks on the main thread
  only in the admin case. The reviewer found them by opening the registry
  source; do that first next time.

## Usability pass

- **A client-side route change is invisible to the shell.** The login
  page's Docs link was a react-router `<Link to="/docs">`; `/docs` is a
  separate VitePress site, not a route, so the app rendered a blank page (on
  the web too) and the desktop navigation hook never fired. Links that leave
  the SPA must be real `<a href>`s.
- **Same origin is not the same app.** wafflebase.io serves the app, the
  homepage and the docs site from one origin; the shell's "frontend origin
  stays in-window" rule kept the docs in a window with no way back.
- **Test a `target=_blank` click with a real gesture.** A click synthesised
  by `eval` is treated as a popup and blocked before WKWebView's new-window
  delegate runs, so a scripted check of the GitHub link proves nothing either
  way.
- **Browser shortcuts collide with Google parity.** Cmd+[ / Cmd+] (Docs
  indent) and Cmd+R (Sheets fill right) belong to the editors; menu
  accelerators would steal them, so Back / Forward / Reload ship without any.
