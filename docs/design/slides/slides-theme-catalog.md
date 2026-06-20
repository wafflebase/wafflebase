---
title: slides-theme-catalog
target-version: 0.5.0
---

# Slides Theme Catalog (Google-Slides-parity, de-branded)

## Summary

The five built-in slide themes ship with the **Wafflebase brand
palette melted into the defaults**: `default-light` and `default-dark`
bind their accents to `palette.syrup` / `palette.butter` /
`palette.berry` / `palette.leaf` and their fonts to the brand
`typography.display` stack (`packages/slides/src/themes/default-light.ts`,
`packages/slides/src/themes/default-dark.ts`). Every new deck therefore inherits the waffle brand
colors as its "Simple Light" default — which is not what Google Slides'
"Simple Light" connotes (a neutral, near-monochrome base with one
restrained accent).

This design **de-brands the defaults** and **expands the catalog to ~23
themes** for Google-Slides gallery parity, while keeping the existing
flat-list model (`Theme`, `ThemePanel`, `ThemeThumbnail`) unchanged. The
work is **pure data**: theme literals plus ordering, no schema, model, or
UI structure change.

### Goals

- Make the two default themes (`default-light`, `default-dark`)
  **neutral**: near-monochrome text/background with a single restrained
  accent family and a neutral body font (Inter), matching the mental
  model of Google Slides' "Simple Light" / "Simple Dark".
- Move the Wafflebase brand palette (syrup / butter / berry / leaf +
  brand display/body fonts) into **one dedicated `wafflebase` theme**,
  placed last in the picker, so the brand look is a deliberate one-click
  choice rather than the silent default.
- Grow the built-in catalog from 5 to **~23 themes**, ordered the way
  Google Slides orders its gallery: neutral defaults first, then light
  professional, warm/editorial, vibrant, dark, brand last.
- Keep all theme thumbnails **live-rendered** from the `Theme` literal
  (no PNG/SVG assets) so the catalog adds ~0 bundle/asset cost.
- Keep theme **ids stable** for the existing five so no Yorkie remap is
  needed.

### Non-Goals

- **Structural / model change.** No `Theme` schema change, no PPT-style
  two-tier "theme + variants", no per-slide theme override. The flat-list
  model from `slides-themes-layouts-import.md` is retained verbatim.
- **Theme builder edits.** Editing a built-in theme's colors/fonts in the
  editor is still the PR3 / v1.5 scope of
  `slides-themes-layouts-import.md`.
- **Pixel-faithful copies of Google Slides' themes.** Names follow Google
  Slides naming conventions where they are generic and descriptive, but
  **every palette is designed fresh** here — we do not copy Google's
  exact swatch values.
- **New fonts.** All theme fonts are drawn from the existing font catalog
  (`packages/frontend/src/components/text-formatting/font-catalog.data.ts`)
  so they lazy-load through the established loader; no new font assets are
  added.

## Current state

`packages/slides/src/themes/index.ts` registers five themes in picker
order: `defaultLight`, `defaultDark`, `streamline`, `focus`, `material`.
`ThemePanel` (`packages/frontend/src/app/slides/theme-panel.tsx`) maps
`BUILT_IN_THEMES` to `ThemeThumbnail` cards; the thumbnail
(`packages/frontend/src/app/slides/theme-thumbnail.tsx`) paints `aA` in `theme.fonts.heading`, the six
accents as a strip, and the name — all from the literal, no assets.

The problem is isolated to the two defaults:

```ts
// default-light.ts (current)
accent1: palette.syrup,   accent2: palette.butter,
accent3: palette.berry,   accent4: palette.leaf,
fonts: { heading: firstFamily(typography.display), body: firstFamily(typography.body) }
```

Because element colors picked from the **Theme** row store
`{ kind: 'role', role: 'accent1' }` (hybrid binding, see
`slides-themes-layouts-import.md`), the brand palette renders on every
role-bound element of every new deck.

## Proposal

### Model — unchanged

No change to `Theme`, `ColorScheme`, `FontScheme`, `resolveColor`,
`resolveFont`, the Yorkie schema, or migration machinery. The picker
stays a flat list. The only code that changes is:

- `packages/slides/src/themes/*.ts` — rewrite the two defaults, add ~18
  new theme literals, add a `wafflebase` theme module.
- `packages/slides/src/themes/index.ts` — extend `BUILT_IN_THEMES` and
  re-export the new modules.

### De-branding the defaults

`default-light` and `default-dark` keep their **ids** (no remap) but are
rewritten to neutral palettes and the Inter body/heading font. The brand
palette moves to the new `wafflebase` theme, which keeps the
`@wafflebase/tokens` `palette.*` and `typography.*` bindings so the old
default look is reproducible in one click.

### Catalog and order

Groups below are the **ordering rationale only**; the picker renders one
flat scrollable column (Google-Slides parity). All hex values are the
intended `accent1` plus the background; the full 12-slot `ColorScheme`
for each theme is in the table that follows.

| # | id | name | background | accent1 | heading / body |
|---|---|---|---|---|---|
| 1 | `default-light` | Simple Light | `#FFFFFF` | `#1A73E8` | Inter / Inter |
| 2 | `default-dark` | Simple Dark | `#202124` | `#8AB4F8` | Inter / Inter |
| 3 | `streamline` | Streamline | `#FAFAFA` | `#1976D2` | Work Sans / Work Sans |
| 4 | `swiss` | Swiss | `#FFFFFF` | `#E2231A` | Archivo / Inter |
| 5 | `paradigm` | Paradigm | `#FFFFFF` | `#0F8B8D` | Montserrat / Lato |
| 6 | `material` | Material | `#FFFFFF` | `#3F51B5` | Roboto / Roboto |
| 7 | `shift` | Shift | `#FBFAFF` | `#5E35B1` | DM Sans / DM Sans |
| 8 | `momentum` | Momentum | `#FFFFFF` | `#2E7D32` | Poppins / PT Sans |
| 9 | `focus` | Focus | `#FAF3E7` | `#C2410C` | Lora / Inter |
| 10 | `luxe` | Luxe | `#FAFAF8` | `#B08D57` | Playfair Display / Lato |
| 11 | `modern-writer` | Modern Writer | `#FCFBF7` | `#3D5A80` | EB Garamond / PT Serif |
| 12 | `coral` | Coral | `#FFF7F3` | `#FF6B6B` | Poppins / Nunito |
| 13 | `spearmint` | Spearmint | `#F4FBF8` | `#11998E` | Rubik / Rubik |
| 14 | `pop` | Pop | `#FFFFFF` | `#FF2E63` | Montserrat / Open Sans |
| 15 | `tropic` | Tropic | `#FFFFFF` | `#00897B` | Poppins / Mulish |
| 16 | `marina` | Marina | `#F7FAFC` | `#1B6CA8` | Raleway / Lato |
| 17 | `geometric` | Geometric | `#FFFFFF` | `#E63946` | Oswald / Work Sans |
| 18 | `plum` | Plum | `#FBF7FC` | `#8E24AA` | Manrope / Manrope |
| 19 | `slate` | Slate | `#1E293B` | `#38BDF8` | Inter / Inter |
| 20 | `forest` | Forest | `#1B2A20` | `#74C69D` | Bitter / Source Sans 3 |
| 21 | `spotlight` | Spotlight | `#0D0D0D` | `#FFD60A` | Oswald / Inter |
| 22 | `beach-day` | Beach Day | `#FBFCFD` | `#00A8CC` | Quicksand / Nunito |
| 23 | `wafflebase` | Wafflebase | tokens (brand) | `palette.syrup` | display / body (tokens) |

### Full palettes

Each theme's twelve `ColorScheme` slots —
`text, background, textSecondary, backgroundAlt, accent1..accent6,
hyperlink, visitedHyperlink`:

| id | text | background | textSecondary | backgroundAlt | a1 | a2 | a3 | a4 | a5 | a6 | link | visited |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `default-light` | `#1A1A1A` | `#FFFFFF` | `#5F6368` | `#F1F3F4` | `#1A73E8` | `#5F6368` | `#34A853` | `#FBBC04` | `#EA4335` | `#A142F4` | `#1A73E8` | `#681DA8` |
| `default-dark` | `#E8EAED` | `#202124` | `#9AA0A6` | `#303134` | `#8AB4F8` | `#9AA0A6` | `#81C995` | `#FDD663` | `#F28B82` | `#C58AF9` | `#8AB4F8` | `#C58AF9` |
| `streamline` | `#212121` | `#FAFAFA` | `#616161` | `#EEEEEE` | `#1976D2` | `#0D47A1` | `#1565C0` | `#42A5F5` | `#90CAF9` | `#E3F2FD` | `#1976D2` | `#7B1FA2` |
| `swiss` | `#111111` | `#FFFFFF` | `#555555` | `#F2F2F2` | `#E2231A` | `#111111` | `#7A7A7A` | `#C4C4C4` | `#E2231A` | `#000000` | `#E2231A` | `#9A1812` |
| `paradigm` | `#1B2A33` | `#FFFFFF` | `#4A5D68` | `#EDF2F4` | `#0F8B8D` | `#143642` | `#14746F` | `#A2D6D4` | `#EC9A29` | `#0B5563` | `#0F8B8D` | `#143642` |
| `material` | `#212121` | `#FFFFFF` | `#757575` | `#F5F5F5` | `#3F51B5` | `#009688` | `#FFC107` | `#F44336` | `#9C27B0` | `#FF5722` | `#3F51B5` | `#7B1FA2` |
| `shift` | `#1E1B2E` | `#FBFAFF` | `#5B5670` | `#EEEBFA` | `#5E35B1` | `#3949AB` | `#7E57C2` | `#B39DDB` | `#9575CD` | `#311B92` | `#5E35B1` | `#311B92` |
| `momentum` | `#1F2421` | `#FFFFFF` | `#5A6B5D` | `#EEF2EE` | `#2E7D32` | `#43A047` | `#66BB6A` | `#A5D6A7` | `#1B5E20` | `#81C784` | `#2E7D32` | `#1B5E20` |
| `focus` | `#3E2C1C` | `#FAF3E7` | `#7A5A36` | `#F0E4CF` | `#C2410C` | `#A16207` | `#854D0E` | `#9A3412` | `#7C2D12` | `#451A03` | `#C2410C` | `#7C2D12` |
| `luxe` | `#1C1C1C` | `#FAFAF8` | `#6B6B68` | `#ECEAE3` | `#B08D57` | `#1C1C1C` | `#8C6D3F` | `#D4AF7A` | `#5C5C5C` | `#A38B6D` | `#B08D57` | `#8C6D3F` |
| `modern-writer` | `#2B2B2B` | `#FCFBF7` | `#6E6A60` | `#EFEDE4` | `#3D5A80` | `#98623C` | `#5C7A5C` | `#BFA15B` | `#2B2B2B` | `#7D6B53` | `#3D5A80` | `#98623C` |
| `coral` | `#3A2C2C` | `#FFF7F3` | `#8A6F6A` | `#FBE6DD` | `#FF6B6B` | `#FF8E72` | `#FFA987` | `#F4A259` | `#C44536` | `#FFB4A2` | `#FF6B6B` | `#C44536` |
| `spearmint` | `#14302A` | `#F4FBF8` | `#4E7268` | `#DCF0E8` | `#11998E` | `#1DBF73` | `#2DD4BF` | `#88E0C0` | `#0B7A6E` | `#38EF7D` | `#11998E` | `#0B7A6E` |
| `pop` | `#16161A` | `#FFFFFF` | `#55555F` | `#F0F0F3` | `#FF2E63` | `#08D9D6` | `#FFD460` | `#6A2C70` | `#00ADB5` | `#FF5722` | `#FF2E63` | `#6A2C70` |
| `tropic` | `#102A2E` | `#FFFFFF` | `#4C6B6E` | `#E6F2F1` | `#00897B` | `#FB8C00` | `#26A69A` | `#FFB74D` | `#00695C` | `#FF7043` | `#00897B` | `#00695C` |
| `marina` | `#0D1B2A` | `#F7FAFC` | `#495867` | `#DCE7F0` | `#1B6CA8` | `#0E4D70` | `#3B8EC4` | `#7FB2D6` | `#143A52` | `#5BA3CF` | `#1B6CA8` | `#0E4D70` |
| `geometric` | `#1A1A1A` | `#FFFFFF` | `#595959` | `#F0F0F0` | `#E63946` | `#1D3557` | `#F1A208` | `#2A9D8F` | `#457B9D` | `#6D597A` | `#1D3557` | `#6D597A` |
| `plum` | `#2A1A2E` | `#FBF7FC` | `#6E5A72` | `#F0E4F2` | `#8E24AA` | `#C2185B` | `#AB47BC` | `#E1BEE7` | `#6A1B9A` | `#D81B60` | `#8E24AA` | `#6A1B9A` |
| `slate` | `#E2E8F0` | `#1E293B` | `#94A3B8` | `#334155` | `#38BDF8` | `#22D3EE` | `#818CF8` | `#A78BFA` | `#2DD4BF` | `#60A5FA` | `#38BDF8` | `#A78BFA` |
| `forest` | `#E8EDE6` | `#1B2A20` | `#9BB0A0` | `#2C4133` | `#74C69D` | `#B7E4C7` | `#D9A05B` | `#95D5B2` | `#52B788` | `#E9C46A` | `#74C69D` | `#52B788` |
| `spotlight` | `#F5F5F5` | `#0D0D0D` | `#A0A0A0` | `#1A1A1A` | `#FFD60A` | `#F5F5F5` | `#FFC300` | `#6E6E6E` | `#FFD60A` | `#FFFFFF` | `#FFD60A` | `#FFC300` |
| `beach-day` | `#2B3A42` | `#FBFCFD` | `#5E7682` | `#E4F1F6` | `#00A8CC` | `#F4D35E` | `#EE964B` | `#00B4D8` | `#0077B6` | `#F7A072` | `#00A8CC` | `#0077B6` |

`wafflebase` is not listed with hex because it binds to
`@wafflebase/tokens` (`palette.syrup`, `palette.butter`, `palette.berry`,
`palette.leaf`, `palette.syrupDeep`, `palette.berryBright`, the
`palette.neutrals.light.*` slots, and `typography.display` / `body`) —
it is the verbatim move of today's `default-light` body.

### Font reuse

Theme `heading` fonts drive the picker thumbnails (each card paints `aA`
in `theme.fonts.heading`). To keep the number of distinct fonts loaded
when the panel opens bounded, headings reuse a small pool — Inter, Work
Sans, Archivo, Montserrat, Roboto, DM Sans, Poppins, Lora, Playfair
Display, EB Garamond, Rubik, Raleway, Oswald, Manrope, Bitter, Quicksand
— all already in the catalog. Thumbnails do not block on font load: the
browser renders a system fallback until the catalog loader resolves the
family, so an unloaded heading font degrades gracefully rather than
janking the panel.

## Migration and compatibility

- **Ids are stable** for `default-light`, `default-dark`, `streamline`,
  `focus`, `material`. New ids (`swiss`, `paradigm`, …, `wafflebase`) are
  additive. No Yorkie remap, no read-time migration change.
- **Existing decks shift color, by design.** A deck created before this
  change defaults to `default-light`; its role-bound elements
  (`{ kind: 'role', role: 'accent1' }`) currently resolve to
  `palette.syrup` and will resolve to `#1A73E8` (neutral blue) after the
  rewrite. This is the intended effect — removing the brand bleed — and
  is **not lossless**. Concrete `{ kind: 'srgb' }` colors are unaffected.
  Anyone who wants the prior brand look applies the **Wafflebase** theme
  once (one undo step, via the existing `addTheme` + `applyTheme` batch).
- **Forward compatible.** Adding theme literals does not touch the
  document schema; old clients that pin an unknown imported theme id
  already fall back via `getBuiltInTheme` → `defaultLight`.

## Testing

### Unit (Vitest, `packages/slides/src/themes/*.test.ts`)

- A single `catalog.test.ts` asserts, for **every** theme in
  `BUILT_IN_THEMES`: all twelve `ColorScheme` slots are present and are
  valid `#RRGGBB` hex (resolved through tokens for `wafflebase`); both
  font slots are non-empty; ids are unique; the first two ids are
  `default-light` and `default-dark`; the last is `wafflebase`. This is
  the transitive guard that replaces per-theme snapshots — it scales to
  23 themes without 23 fixtures.
- A `fonts-in-catalog.test.ts` asserts every theme `heading` / `body`
  family exists in the frontend font catalog (imported list), so a theme
  cannot reference a font the loader can't resolve.

### Visual regression (harness)

The existing slides scenarios snapshot "five themes × shared
composition". Snapshotting all 23 is over-broad and flaky. Replace with a
**representative subset of six**: `default-light`, `default-dark`
(neutral defaults), `focus` (serif/warm), `pop` (vibrant), `slate`
(dark), `wafflebase` (brand). The unit catalog test covers the
remaining seventeen for structural validity.

Baselines under
`packages/frontend/tests/visual/baselines/` are regenerated for the six.

### Manual smoke

`pnpm dev` → open a deck → Theme panel scrolls the full 23-card list;
apply `wafflebase` to confirm the old brand look is reproducible; apply
`slate` to confirm a dark theme renders text/background/accents
correctly.

## Risks and Mitigation

| Risk | Impact | Mitigation |
|---|---|---|
| De-branding `default-light` changes existing decks' role-bound colors. | Users perceive their decks "changed". | Documented, intended ("brand bleed" is the bug). One-click `wafflebase` theme restores the old look. Concrete hex colors untouched. |
| 23 distinct heading fonts load when the panel opens. | Panel jank / network burst. | Heading fonts reuse a bounded pool (~16 families, all in catalog); thumbnails fall back to system font until loaded — never block. |
| Snapshotting 23 themes balloons the visual lane and flakes. | CI noise. | Snapshot a 6-theme representative subset; cover the other 17 via the structural unit test. |
| Hand-authored palettes have poor text/background contrast on some themes. | Accessibility. | `catalog.test.ts` extended with a WCAG-AA contrast check between `text`/`background` and `text`/`backgroundAlt` per theme. |
| Bundle size from 23 literals. | Frontend chunk gate. | Literals are ~1 KB each, tree-shaken into the slides chunk; thumbnails are live-rendered (no assets). Chunk gate measured before merge. |

## Rollout

Single PR, commit-layered (each commit `pnpm verify:fast` green):

1. `feat(slides): de-brand default-light/dark, add wafflebase brand theme`
2. `feat(slides): add 18 Google-Slides-parity built-in themes`
3. `feat(slides): catalog validity + font-in-catalog + contrast tests`
4. `test(frontend): retarget slides theme visual snapshots to 6-theme subset`

Acceptance:

- `BUILT_IN_THEMES` has 23 entries, neutral defaults first, `wafflebase`
  last.
- `catalog.test.ts` + `fonts-in-catalog.test.ts` green; contrast check
  passes for all themes.
- Harness 6-theme subset snapshots regenerated and green.
- Manual smoke: panel scrolls 23, `wafflebase` reproduces the prior
  default look.

## Future / Out of Scope

- **Theme builder** (edit a built-in's colors/fonts) — PR3 of
  `slides-themes-layouts-import.md`.
- **PPT-style variants** (color/font sub-variations per theme) — only if
  demand appears; the flat list is sufficient for Google-Slides parity.
- **Per-slide theme override** — still deferred.
- **docs theme catalog** — docs absorbs `ThemeColor` but has no theme
  picker yet; a docs-side catalog is its own design.
