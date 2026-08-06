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

- [x] A — bump stale `pnpm.overrides`, `pnpm install`, verify resolved versions
- [x] B — add `body-parser` overrides
- [x] D — refresh `scripts/agent` deps (`npm update`; no overrides needed)
- [x] C — bump `react-router-dom` to `^7.18.2` + override; confirm RSC mode
      is unused and dismiss alert #134 with "vulnerable code is not actually used"
- [x] `pnpm verify:fast` green
- [x] Push, open PR, confirm Dependabot closes the alerts

## Known residual

- **vite 5.4.21** (3 alerts) remains via `vitepress` (docs-site builder).
  The advisories have range `<= 6.4.2` with no lower bound, so 5.4.21 still
  matches even though the app itself is on 6.4.3. `vitepress@1.6.4` (latest
  stable) pins `vite ^5.4.14`; no stable vitepress uses vite 6/7, and forcing
  vite 6 breaks the docs build. Build-time only, not in app runtime. Same
  conclusion as the 2026-06 pass.

## Review

Three commits, one per fix class:

1. `Refresh stale pnpm overrides…` — 27 alerts. Only `package.json` +
   `pnpm-lock.yaml`; no direct dependency moved.
2. `Update the agent-scripts lock…` — 5 alerts. No npm `overrides` were
   needed after all: `npm update` pulled `@modelcontextprotocol/sdk`
   1.29.0 → 1.30.0, which widens its `@hono/node-server` range to
   `^1.19.9 || ^2.0.5`, so the patched v2 line resolved on its own.
3. `Bump react-router to 7.18.2…` — 4 alerts, plus a direct
   `react-router-dom` bump in `packages/frontend`.

Verified by cross-checking every open alert's vulnerable range against the
versions actually resolved in both lockfiles (semver `satisfies`):
35 of 39 no longer match. The remaining 4 are the two known exceptions —
alert #134 (dismissed, see below) and the 3 vitepress-borne vite alerts.

`pnpm verify:fast` green after each commit; `pnpm frontend build` green
after the react-router bump; `npm test` (942 tests) green in
`scripts/agent`.

**Alert #134 — dismissed as not applicable.** React Router's RSC-mode CSRF
bypass is patched only in 8.3.0, with no 7.x backport. The frontend mounts
a plain `BrowserRouter` in `packages/frontend/src/App.tsx` and imports no
RSC API (no `@react-router/dev` framework mode, no `createCallServer`, no
server request handler), so the vulnerable path is unreachable. Revisit if
the app ever adopts RSC mode.
