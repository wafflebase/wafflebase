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

- [x] Rewrite `default-light` / `default-dark` to neutral palettes + Inter
      (keep ids stable). — Task 1
- [x] Add `wafflebase` theme module (verbatim move of today's brand
      default body: tokens palette + display/body fonts). — Task 1
- [x] Add 17 new theme literals (swiss, paradigm, shift, momentum, luxe,
      modern-writer, coral, spearmint, pop, tropic, marina, geometric,
      plum, slate, forest, spotlight, beach-day) per the design's palette
      table; keep `streamline`, `focus`, `material`. — Task 2
- [x] Order `BUILT_IN_THEMES`: neutral defaults → light pro → warm →
      vibrant → dark → `wafflebase` last. — Task 2
- [x] Re-export new modules from `packages/slides/src/themes/index.ts`. — Task 2
- [x] Add catalog validity test (all 12 slots valid hex, unique ids,
      defaults first, wafflebase last) + WCAG-AA text/bg contrast check. — Task 3
- [x] Add font-in-catalog test (every heading/body family exists in the
      frontend font catalog). — Task 4
- [x] Retarget slides theme visual snapshots to a 6-theme subset
      (default-light, default-dark, focus, pop, slate, wafflebase);
      regenerate baselines. — Task 5
- [x] `pnpm verify:fast` green per commit; `pnpm verify:self` green. — Task 6
- [ ] Manual smoke in `pnpm dev` (theme panel scrolls 23; wafflebase
      restores brand look; slate renders dark correctly). — pending human run

## Review

Shipped via 5 implementation commits + tests on branch
`slides-theme-catalog`, each reviewed by a task reviewer subagent:

- **Task 1** (`933e2e71`): de-branded the two defaults to neutral Google
  palettes (Inter); moved syrup/butter/berry/leaf into a new `wafflebase`
  theme appended last. Review clean.
- **Task 2** (`b0183f96`): 17 new theme literals + final 23-entry ordering.
  Review clean, zero issues — pixel-exact transcription of the design's
  palette table.
- **Task 3** (`c8f73a02`): catalog validity + WCAG-AA contrast guard. All
  23 themes pass AA (text over background and backgroundAlt) on first run
  — **no palette adjustment needed**. Reviewer verified the WCAG math.
- **Task 4** (`b52ad6b0`): font-availability test in `frontend` (not
  slides — slides must not depend on frontend). All 23 themes' fonts exist
  in the catalog.
- **Task 5** (`55b7fd81`): visual snapshots retargeted to the 6-theme
  subset; baselines regenerated in Docker.

Verification: `pnpm verify:self` all lanes green — including
`verify:frontend:chunks` (23 themes did **not** balloon the bundle:
thumbnails are live-rendered from literals, no assets) and
`verify:entropy` doc-staleness (the design README link resolves).

Migration note (as designed, intended, not lossless): existing decks
default to `default-light`; their role-bound colors shift from the brand
syrup family to the neutral Google palette. The `Wafflebase` theme
reproduces the prior look in one click.
