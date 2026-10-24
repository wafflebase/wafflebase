# Dependabot Security Patch (2026-10) — Lessons

- `pnpm` on `PATH` may not be the `packageManager` version. Regenerate the
  lockfile with `npx pnpm@<packageManager>` so CI and local agree.
- A tilde range is not a pin: `~0.18.10` still resolves a deprecated
  `0.18.11`. When a patch line has a known-bad later release, pin exactly.
- Overriding one package of a lockstep family (`@vue/*`) duplicates the
  family. Override the umbrella package instead and check for one copy.
- A pnpm override also rewrites matching **peer** ranges to the override's
  exact value. Prefer an explicit devDependency for peers.
- Dependabot lags the advisory database. Run `pnpm audit` / `npm audit`
  after patching, or the next batch of alerts arrives right after the merge.
- To judge a visual change from a major-ish bump, render the same input on a
  clean `main` checkout too; a "broken" render may be existing behavior.
