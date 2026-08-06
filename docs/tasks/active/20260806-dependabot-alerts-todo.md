# Fix Dependabot alerts (2026-08)

## Context

39 open Dependabot alerts on `github.com/wafflebase/wafflebase`, covering
13 distinct packages. All of them are transitive (lockfile) findings —
34 in `pnpm-lock.yaml`, 5 in `scripts/agent/package-lock.json`. The repo
already fixes transitive CVEs via `pnpm.overrides` in the root
`package.json`; most existing overrides have gone stale (pinned below the
now-required patched version), exactly like the 2026-05 and 2026-06 passes.

`scripts/agent/` is a separate npm-managed package (agent pipeline
scripts, not part of the pnpm workspace), so it needs its own fix.

## Alerts → fix

Group A — stale `pnpm.overrides` (25 alerts):

| Package | Pinned before | Patched | Override range |
|---|---|---|---|
| brace-expansion ×7 | 1.1.13 / 2.0.3 / 5.0.6 | 1.1.16 / 2.1.4 / 5.0.9 | three ranges |
| undici ×5 | 7.28.0 | 7.29.0 | `>=7.0.0 <7.29.0` |
| fast-uri ×3 | 3.1.2 | 3.1.5 | `<3.1.5` |
| postcss ×3 | 8.5.10 | 8.5.23 | `<8.5.23` |
| js-yaml ×3 | 3.14.2 / 4.2.0 | 3.15.0 / 4.3.0 | two ranges |
| tmp | 0.2.6 | 0.2.7 | `<0.2.7` |
| shell-quote | 1.8.4 | 1.9.0 | `<1.9.0` |

Group B — new overrides (2 alerts):

| Package | Resolved before | Patched | Override range |
|---|---|---|---|
| body-parser ×2 | 1.20.5 / 2.2.2 | 1.20.6 / 2.3.0 | two ranges |

Group D — `scripts/agent/package-lock.json` (5 alerts):

| Package | Resolved before | Patched | Action |
|---|---|---|---|
| hono | 4.12.31 | 4.12.34 | npm `overrides` |
| @hono/node-server | 1.19.14 | 2.0.5 | npm `overrides` |
| ip-address ×3 | 10.2.0 | 10.3.1 | npm `overrides` |

Group C — react-router (5 alerts):

| Package | Resolved before | Patched | Action |
|---|---|---|---|
| react-router ×4 | 7.15.1 | 7.18.0 | override + bump `react-router-dom` direct dep to `^7.18.2` |
| react-router #134 | 7.15.1 | 8.3.0 only | no 7.x backport — dismiss if RSC mode is unused |

## Steps

- [ ] A — bump stale `pnpm.overrides`, `pnpm install`, verify resolved versions
- [ ] B — add `body-parser` overrides
- [ ] D — add npm `overrides` in `scripts/agent/package.json`, `npm install`
- [ ] C — bump `react-router-dom` to `^7.18.2` + override; confirm RSC mode
      is unused and dismiss alert #134 with "vulnerable code is not actually used"
- [ ] `pnpm verify:fast` green
- [ ] Push, open PR, confirm Dependabot closes the alerts

## Known residual

- **vite 5.4.21** (3 alerts) remains via `vitepress` (docs-site builder).
  The advisories have range `<= 6.4.2` with no lower bound, so 5.4.21 still
  matches even though the app itself is on 6.4.3. `vitepress@1.6.4` (latest
  stable) pins `vite ^5.4.14`; no stable vitepress uses vite 6/7, and forcing
  vite 6 breaks the docs build. Build-time only, not in app runtime. Same
  conclusion as the 2026-06 pass.

## Review

_(filled in after implementation)_
