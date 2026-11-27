# Docs site brand neutrals — lessons

- A brand refresh that changes `palette.brandNeutrals` must also update the
  docs site theme; it copies the values by hand. #1143 updated the docs
  site's mark and wordmark but not its colors, and the theme's "mirrors the
  homepage palette" comment hid the drift.
- VitePress's `brand-1` colors link *text*, so it needs the text-grade accent
  (strong syrup), not the graphic one (plain syrup).
- VitePress ships hues the brand never chose (`important` = purple); audit
  every `--vp-c-*` family the content uses, not just the ones already
  overridden.

## Self-review

- Round 1: test-adequacy blocked — the theme's contrast claims had no test.
  Fixed: a core token test that parses the docs theme, pins it to the
  palette and asserts the ratios; tertiary text raised to AA so the test can
  hold every text tier to 4.5:1.
- Restoring a mutation check with `git checkout -- <file>` discards
  uncommitted edits too; back up the working copy and restore from that.
- Round 2: blast-radius blocked — path-aware CI would skip the new test on a
  docs-theme-only change, the case it guards. Fixed: `core:test` lane takes
  the `documentation` tag (cheap, no `needs`); lane test and the
  `harness.config.json` reason updated.
- Round 3: clean — all six lenses passed; loop stopped.
