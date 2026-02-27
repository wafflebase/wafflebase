# Lessons

- Keep frontend runtime source (`src`) focused on shipped app code, and place
  test-only assets under a dedicated `tests` tree.
- When relocating tests, update relative imports immediately and verify with
  direct package-level test commands before broader lanes.
- Visual baseline paths should be centralized in verifier scripts so location
  changes require only script updates, not test logic rewrites.
- After user correction on repo layout expectations, encode the layout rule in
  task lessons to prevent future drift.
- Before committing, check commit body line lengths and wrap every body line
  at 80 characters to satisfy repository commit-message rules.
