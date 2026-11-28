# iOS mobile shell — lessons

- Parallel agents sharing one working tree need file ownership *and*
  a compile contract: the scaffold agent gated `lib.rs` for iOS but could
  not fix `signin.rs` (another agent's file), so the iOS target stayed
  broken until the dependent agent ran. Run agents that must agree on a
  crate's compile surface in sequence, not in parallel.
- `tauri ios init` installs Homebrew tools (xcodegen, cocoapods,
  libimobiledevice), and libimobiledevice unlinks openssl@3. Warn the user
  before running it on their machine.
- A cfg-gated crate needs a check for each target: host clippy passing says
  nothing about `--target aarch64-apple-ios-sim`.
- Inherited gates may not cover a new mode: the consent middleware ran
  before the guard's `Sec-Fetch-Site` check, so the guard never saw a
  cross-site start. When adding a mode, trace where each existing check
  runs relative to the new path.
