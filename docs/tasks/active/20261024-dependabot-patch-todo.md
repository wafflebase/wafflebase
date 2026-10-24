# Dependabot Security Patch (2026-10) — Task Tracking

72 open Dependabot alerts across 21 packages in `pnpm-lock.yaml` and
`scripts/agent/package-lock.json`. While patching, `pnpm audit` / `npm audit`
surfaced newer advisories Dependabot had not raised yet (body-parser, zod,
vite, and higher floors for dompurify/multer/undici/fast-uri/ip-address/
serialize-javascript); they are folded in so the next alert batch is empty.

## Plan

- [x] Raise root `pnpm.overrides` floors: undici, multer, brace-expansion (1/2/5),
      js-yaml (3/4), fast-uri, smol-toml, body-parser (1/2), vite,
      serialize-javascript
- [x] Add root overrides: hono, ip-address, source-map-js, vue, dompurify,
      fast-copy, @vitest/mocker, katex, zod (4.x), postcss-selector-parser
- [x] Raise direct ranges: markdown-it (notes), vitest + @vitest/coverage-v8
      (all packages), katex (frontend, notes), dompurify (notes);
      add `@modelcontextprotocol/sdk` as a debug-report devDependency
- [x] `scripts/agent` overrides: proxy-addr, @modelcontextprotocol/sdk, hono,
      ip-address, fast-uri, body-parser; zod 4.6.6; `npm test` 2750/2750
- [x] Confirm no vulnerable version remains in either lockfile
- [x] katex 0.16 → 0.18.10: notes preview harness renders identically to main
- [x] postcss-selector-parser 6 → 7: built frontend CSS differs only in KaTeX
      rules; typography (`prose`) output is unchanged
- [x] `pnpm verify:self` — 32/32 lanes pass (incl. documentation build on vue 3.5.42)
- [ ] PR; after merge dismiss the unpatchable alerts

## Decisions

- **Install with pnpm 10.5.2** (`packageManager`), not the pnpm 9 on `PATH`,
  so the lockfile matches what CI produces.
- **katex pinned exactly to `0.18.10`.** The fix is in 0.18.2. `0.18.11` is
  deprecated upstream ("accidentally published with breaking changes" — the
  0.19 strict-mode change), and `~0.18.10` would still resolve it.
  `@vscode/markdown-it-katex` (`^0.16.4`) and mermaid 11 (`^0.16.47`) are
  forced onto it by override; 0.18.0's only documented break is prefixed
  internal CSS classes, and nothing here styles them.
- **`vue` overridden, not `@vue/server-renderer`.** Overriding only the
  renderer split the Vue runtime into 3.5.30 and 3.5.42 copies under
  vitepress; the Vue packages move in lockstep.
- **No `@modelcontextprotocol/sdk` override in the pnpm workspace.** An
  override rewrites the agent SDK's peer range to the exact override value,
  producing an unmet-peer warning against 1.32.2; an explicit devDependency
  is enough.

## Not patched (dismiss)

- `http-cache-semantics` ≤ 4.2.0 — no patched release. Dev-only, via
  `@swc/cli` → `@xhmikosr/downloader` → `got`.
- `sprintf-js` — advisory withdrawn. Dev-only, via `argparse@1`.
- `zod` 3.x (frontend, `pnpm audit` only, no Dependabot alert yet) — the fix
  exists only in 4.6.6; moving the frontend to zod 4 is a migration, not a
  patch.

## Review

- Mermaid node labels show `$$…$$` literally both before and after: that is
  the `htmlLabels: false` hardening in `packages/notes/src/view/mermaid.ts`,
  not a KaTeX regression.
