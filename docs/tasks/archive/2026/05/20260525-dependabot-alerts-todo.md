---
title: Resolve 22 open Dependabot alerts
date: 2026-05-25
status: done
---

# Resolve 22 open Dependabot alerts

GitHub Dependabot reports 22 open alerts (6 high, 14 medium, 2 low), all
npm dependencies surfaced through `pnpm-lock.yaml`. The repo already
manages transitive vulns via a `pnpm.overrides` block, but several
overrides have gone **stale** — they pin to a version that has since
received a *new* advisory.

## Root cause

- Stale overrides pin to a now-vulnerable version (lodash 4.17.23,
  serialize-javascript 7.0.3, brace-expansion 1.1.12 / 5.0.5).
- Override ranges too narrow: `file-type` covers only `>=20` (19.6.0
  leaks), `picomatch` covers only `4.x` (2.3.1 leaks), `brace-expansion`
  2.x line uncovered.
- Newly-flagged packages with no override yet.
- Two direct deps need manifest bumps (`vite`, `@nestjs/core`).

## Plan

### A. Update stale `pnpm.overrides` entries
- [x] `lodash` 4.17.23 → `lodash@<4.18.0` → 4.18.0 (#78, #77)
- [x] `serialize-javascript` 7.0.3 → `<7.0.5` → 7.0.5 (#88)
- [x] `brace-expansion`: `<1.1.13` → 1.1.13 (#73); `>=5.0.0 <5.0.6` →
      5.0.6 (#87)
- [x] `file-type` broaden to `<21.3.2` → 21.3.2 (#52, covers 19.6.0)
- [x] `picomatch` add `<2.3.2` → 2.3.2 (#71, keep 4.x entry)

### B. Add new `pnpm.overrides`
- [x] `fast-uri@<3.1.2` → 3.1.2 (#85, #86)
- [x] `fast-xml-builder@<1.1.7` → 1.1.7 (#84)
- [x] `fast-xml-parser@<5.7.0` → 5.7.0 (#82)
- [x] `path-to-regexp@>=8.0.0 <8.4.0` → 8.4.0 (#75, #76)
- [x] `brace-expansion@>=2.0.0 <2.0.3` → 2.0.3 (#72, #7)
- [x] `tmp@<=0.2.3` → 0.2.4 (#12, via @nestjs/cli)
- [x] `esbuild@<0.25.0` → 0.25.0 (#62, via vitepress)
- [x] `postcss@<8.5.10` → 8.5.10 (#83)
- [x] `qs@<6.15.2` → 6.15.2 (#89)

### C. Direct dependency bumps
- [x] `vite` `^6.4.1` → `^6.4.2` in frontend, docs, sheets, slides
      (#80, #81)
- [x] `@nestjs/core` pull 11.1.18 via lockfile refresh (#79, `^11.1.0`
      already permits it)

### D. Verify
- [x] `pnpm install` regenerates lockfile cleanly
- [x] No vulnerable versions remain in `pnpm-lock.yaml`
- [x] `pnpm verify:fast` (lint + unit tests) green
- [x] Builds green, esp. documentation (esbuild), backend (tmp,
      file-type), frontend/sheets/docs/slides (vite)

## Risk notes

- `esbuild 0.21→0.25` forced into vitepress's vite 5 — verify docs build.
- `tmp 0.0.33→0.2.4` and `file-type 19→21` are major-line jumps via
  override — verify backend build/tests.

## Review

All 22 open alerts resolved by updating `pnpm.overrides`, bumping `vite`
(4 packages) and `@nestjs/core`, then regenerating the lockfile. A
lockfile scan confirms **zero vulnerable versions remain** for any of the
22 advisories.

### Deviations from plan
- **lodash → 4.18.1, not 4.18.0.** The advisory lists 4.18.0 as
  first-patched, but npm marks 4.18.0 as a deprecated "Bad release. Please
  use lodash@4.17.21 instead." The good fix is 4.18.1 (current `latest`).
  Override pins `lodash@>=4.0.0 <4.18.1` → 4.18.1.
- **vite needed an override, not just manifest bumps.** `vitest 3.1.1`
  pulled its own `vite@6.4.1` copy that the app-level `^6.4.2` bump didn't
  move. Added `vite@>=6.0.0 <6.4.2` → 6.4.2 (scoped to 6.x so vitepress's
  vite 5 is untouched).
- **brace-expansion / picomatch / file-type overrides broadened.** Old
  override ranges left the 2.x brace-expansion line, the 2.x picomatch
  line, and file-type 19.6.0 uncovered.

### Verification
- `pnpm verify:fast` → EXIT=0 (frontend 38, backend 401, sheets 1274,
  slides 1296, cli 191, docs 792; all green).
- `pnpm build` → EXIT=0 (all packages).
- `pnpm documentation build` → EXIT=0 (vitepress with esbuild 0.25 forced
  into its vite 5 — the riskiest override verified safe).

### Known limitation
- `vite@5.4.21` remains via `vitepress 1.6.4` (dev-only docs-site
  builder). The vite advisory range nominally covers it, but it was **not**
  among the 22 flagged alerts and cannot move to vite 6 without a
  vitepress major upgrade. Tracked as a follow-up if Dependabot raises it.

### Outcome
- [x] All A/B/C/D plan items complete; lockfile clean; CI gates green.
