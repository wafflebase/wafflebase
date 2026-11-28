# iOS mobile shell (Phase 1 spike + mobile sign-in)

Goal: build the Tauri desktop shell for iOS, and replace the loopback
sign-in (which iOS suspends in the background) with a custom-URL-scheme
callback guarded by the existing PKCE + nonce, for one PR.

## Plan

- [x] Spike: `tauri ios init`, gate desktop-only plugins (updater,
      single-instance, window-state), menu and multi-window under
      `cfg(desktop)`; `cargo check --target aarch64-apple-ios-sim` passes
- [x] Backend: `?mode=mobile` start that redirects the callback to
      `wafflebase://auth/callback` instead of the loopback; code redeems at
      `POST /auth/desktop/session`; `/auth/providers` advertises
      `mobile.github`; specs
- [x] Shell: mobile sign-in through `tauri-plugin-deep-link`, state/nonce
      checked, handoff page reused; tests
- [x] Design doc: `docs/design/desktop-app.md` mobile section (threat model:
      scheme hijack is answered by PKCE, RFC 8252 §7.1)
- [x] Review panel (security, correctness) → fixes
- [x] verify:fast, desktop test/lint, iOS target check; PR

## Review

Ran as one multi-agent workflow: iOS scaffold, backend `mode=mobile` and
the design doc in parallel, then the shell's mobile sign-in on top of the
scaffold; a security + correctness review panel; one fix pass; a gate run.

- Review found 4 issues, all applied. The one that mattered: a cross-site
  `mode=mobile` start still reached the consent page because
  `CliLoginConfirmMiddleware` never read `Sec-Fetch-Site`; mobile starts
  now get the guard's cross-site 400 instead. The design doc gained the
  client-impersonation case (RFC 8252 §8.6), and stopped claiming that
  simulator sign-in had been tested.
- Gates: desktop `cargo test` 109/109, clippy clean on host and
  `aarch64-apple-ios-sim`, backend auth jest 278/278, backend build,
  `pnpm verify:fast`.
- Not verified: a full Xcode build and end-to-end sign-in on a simulator or
  device. This Xcode (26.6, iOS 26.5 SDK) has only the iOS 18 simulator
  runtimes; `xcodebuild -downloadPlatform iOS` is needed first.
- Follow-ups: ASWebAuthenticationSession (Swift plugin), a way back to the
  server picker after a server loads, an opaque 1024px iOS icon, and the
  App Store review items listed in `docs/design/desktop-app.md` §11.
