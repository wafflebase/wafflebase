# Slides Theme Catalog — de-brand + GS-parity expansion

Design: `docs/design/slides/slides-theme-catalog.md`

## Problem

`default-light` / `default-dark` bind accents to the Wafflebase brand
palette (syrup/butter/berry/leaf) and fonts to the brand display stack,
so every new deck silently inherits brand colors. The catalog is only 5
themes vs Google Slides' ~23.

## Decisions (confirmed)

- Scope: full GS parity (~23 themes).
- Brand: move waffle palette into one dedicated `wafflebase` theme, last
  in the picker. Defaults become neutral.
- Structure: keep the GS-style flat list; no model/UI change.

## Plan

- [ ] Rewrite `default-light` / `default-dark` to neutral palettes + Inter
      (keep ids stable).
- [ ] Add `wafflebase` theme module (verbatim move of today's brand
      default body: tokens palette + display/body fonts).
- [ ] Add 18 new theme literals (swiss, paradigm, shift, momentum, luxe,
      modern-writer, coral, spearmint, pop, tropic, marina, geometric,
      plum, slate, forest, spotlight, beach-day) per the design's palette
      table; keep `streamline`, `focus`, `material`.
- [ ] Order `BUILT_IN_THEMES`: neutral defaults → light pro → warm →
      vibrant → dark → `wafflebase` last.
- [ ] Re-export new modules from `packages/slides/src/themes/index.ts`.
- [ ] Add catalog validity test (all 12 slots valid hex, unique ids,
      defaults first, wafflebase last) + WCAG-AA text/bg contrast check.
- [ ] Add font-in-catalog test (every heading/body family exists in the
      frontend font catalog).
- [ ] Retarget slides theme visual snapshots to a 6-theme subset
      (default-light, default-dark, focus, pop, slate, wafflebase);
      regenerate baselines.
- [ ] `pnpm verify:fast` green per commit; manual smoke in `pnpm dev`.

## Review

(to be filled at completion)
