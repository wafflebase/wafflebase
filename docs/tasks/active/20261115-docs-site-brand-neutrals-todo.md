# Docs site brand neutrals

The brand refresh (#1143) moved the homepage and the other brand surfaces to
`palette.brandNeutrals` (near-neutral ivory/ink, neutral charcoal in dark) but
left the VitePress docs site on the retired yellow-cream / brown-roast values,
so the new Facet mark sat on the old paper. Its theme header still claimed to
mirror the homepage palette.

## Plan

- [x] Audit `packages/documentation/.vitepress/theme/style.css` against
      DESIGN.md and `packages/core/src/tokens/palette.ts`.
- [x] Light: ivory bg, white paper, stone wash, ink/sub, rule; tertiary
      text `#76716a` (4.6:1, was 3.51:1).
- [x] Dark: charcoal bg/paper/wash, ink/sub, rule; tertiary `#8e8880`
      (≥4.7:1 on page and paper).
- [x] Links/active items: strong syrup `#9e5614` (5.26:1) instead of plain
      syrup `#b8651a` (4.06:1, below AA for text). Dark hover pressed bright
      syrup `#c97a30` instead of butter.
- [x] `gray-*` re-tinted to stone.
- [x] `important` callout: syrup instead of VitePress purple (pre-existing);
      deep syrup text in light (4.91:1 on chip), 10% tint in dark (5.01:1).
- [x] Hex copied with a source comment, not imported from core `tokens.css`:
      an import makes `documentation:build` need `core:build` and touches
      the CI gating config. Recorded in DESIGN.md.
- [x] Render check light/dark: self-hosting (important), collaboration
      (warning, tip, table).
- [x] `packages/core/test/tokens/docs-site-theme.test.ts`: pins the copy
      to `brandNeutrals` / the primary pair and asserts every claimed ratio
      (mutation-checked: the old cream + plain syrup fail 4 cases).
- [x] `pnpm documentation build`
- [x] `pnpm verify:fast`

## Review

Colors only; typography, focus ring, selection and wordmark already matched.
Inline code in dark stays butter so it reads apart from bright-syrup links.
