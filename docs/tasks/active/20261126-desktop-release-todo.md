# Desktop release: signing, notarization, updater

Phase 2 of [desktop-app.md](../../design/desktop-app.md) §8, release half:
ship signed, notarized macOS builds and an in-app updater from a
`desktop-v*` tag. Google desktop sign-in and `test:webkit` in CI are the
other half of Phase 2 and are not in this task.

## Decisions

- Channel: GitHub Releases only. No Mac App Store / Microsoft Store (sandbox
  breaks the loopback listener and Downloads writes; review cycle for a shell).
- Server releases own "Latest" on this repo, so `releases/latest/download/…`
  is unusable. Versioned assets go to `desktop-vX.Y.Z` (`make_latest: false`)
  and the update manifest to a rolling `desktop-latest` release. The endpoint
  is compiled into the binary: it cannot move without a manual reinstall.
- macOS: Developer ID Application (G2), individual team `WRGGVTC2RN`. The
  certificate issued 2026-11-26 expires **2027-12-26**; renew yearly.
  Notarization through an App Store Connect Team API key.
- Windows: NSIS, **unsigned** until the Authenticode route (Azure Artifact
  Signing vs OV + cloud HSM) is chosen. The updater payload is still
  minisign-signed.
- Updater key: Tauri minisign key; losing it strands every install.
- Signing secrets live only in the `desktop-release` GitHub Environment.

## Todo

- [x] Developer ID Application (G2) certificate + `.p12` (key generated off-keychain)
- [x] Updater minisign key pair
- [x] `tauri-plugin-updater` + `tauri-plugin-dialog`: background check at launch
      (release builds), "Check for Updates…" menu item, download then ask
      Restart / Later; Later installs on quit
- [x] ~~Endpoint env override~~ — not needed: a test build merges
      `-c '{"plugins":{"updater":{...}}}'`, so the shipped binary has no knob
- [x] Single version source (`tauri.conf.json` reads `package.json`)
- [x] `.github/workflows/desktop-release.yml`: macOS universal (signed +
      notarized) + Windows NSIS, `latest.json`, `desktop-latest`
- [x] Docs: desktop-app.md §5/§7, desktop README release procedure
- [x] Verify: cargo fmt/clippy/test; local signed universal build;
      local 0.1.0 → 0.1.1 update against a local manifest
- [ ] User: App Store Connect API access + Team key; Environment secrets;
      first `desktop-v0.1.0` tag

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

Not verified here: the dialog itself (no screen capture permission in this
session) and Restart Now; tauri's own `APPLE_CERTIFICATE` signing path,
notarization and the Windows job, which only the first tagged run exercises.
