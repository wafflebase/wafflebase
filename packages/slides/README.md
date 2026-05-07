# @wafflebase/slides

Presentation engine for Wafflebase. Pure domain library — no Yorkie,
React, or DOM dependencies. Yorkie integration and the editor UI live
in `packages/frontend/src/app/slides/`.

See [docs/design/slides/slides.md](../../docs/design/slides/slides.md)
for the design.

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm test` | Run Vitest once |
| `pnpm test:watch` | Watch mode |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm build` | Library build (ESM + CJS + .d.ts) |
