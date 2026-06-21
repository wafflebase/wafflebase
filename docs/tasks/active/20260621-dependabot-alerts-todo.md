# Fix Dependabot alerts (2026-06)

## Context

25 open Dependabot alerts on `github.com/wafflebase/wafflebase`, all in
`pnpm-lock.yaml`. Repo already fixes transitive CVEs via `pnpm.overrides`
in the root `package.json`; several existing overrides had gone stale
(pinned below the now-required patched version).

## Alerts → fix

| Package | Resolved before | Patched | Action |
|---|---|---|---|
| undici ×7 | 7.24.0 | 7.28.0 | override `>=7.0.0 <7.28.0` |
| react-router ×7 | 7.13.1 | 7.15.1 | override + bump `react-router-dom` direct dep |
| multer ×2 | 2.1.1 | 2.2.0 | override `<2.2.0` |
| js-yaml | 4.1.1 | 4.2.0 | override `>=4.0.0 <4.2.0` |
| tmp | 0.2.4 | 0.2.6 | override `<0.2.6` |
| piscina | 4.9.2 | 4.9.3 | new override `<4.9.3` |
| form-data | 4.0.5 | 4.0.6 | new override `>=4.0.0 <4.0.6` |
| @babel/core | 7.26.10 | 7.29.6 | new override `<7.29.6` |
| esbuild | 0.27.3 | 0.28.1 | new override `>=0.27.3 <0.28.1` |
| vite ×3 (app) | 6.4.2 | 6.4.3 | override `>=6.0.0 <6.4.3` |

## Steps

- [x] Map every open alert to direct vs transitive dependency
- [x] Update `pnpm.overrides` in root `package.json`
- [x] Bump `react-router-dom` direct dep to `^7.15.1`
- [x] `pnpm install` → regenerate lockfile
- [x] Verify resolved versions are all patched
- [x] `pnpm verify:fast` green (pre-existing slides .at() gate gap only; deps OK)
- [x] Commit, push, open PR

## Known residual

- **vite 5.4.21** remains via `vitepress` (docs-site builder). The vite
  advisories (GHSA-fx2h-pf6j-xcff, -v6wh-96g9-6wx3, -4w7w-66w2-5vf9) have
  range `<= 6.4.2` with no lower bound, so 5.4.21 still matches. vitepress
  1.6.4 (latest stable) pins `vite ^5.4.14`; no stable vitepress uses vite
  6/7, and forcing vite 6 breaks the docs build. Build-time only (static
  site generator), not in app/runtime. The 3 vite alerts may stay open
  against this path until vitepress 2.x ships — dismiss as "no upstream
  fix / dev dependency" if so.
