---
title: Homepage redesign — Butter & Maple landing page
date: 2026-05-03
status: done
---

# Homepage redesign — Butter & Maple landing page

Apply the locked design from
`/Users/hackerwins/Downloads/design_handoff_wafflebase_landing/` to the
existing landing page at `packages/frontend/src/app/home/`.

The handoff is **high-fidelity** — colors, typography, spacing, copy, and
interactions are locked. The reference HTML/JSX/CSS are prototypes, not
shippable code; recreate using existing project patterns (React 19,
TailwindCSS v4, Radix UI, CSS custom properties).

## Locked configuration

| Token | Value |
|---|---|
| `theme` | `butter` (light) + `midnight` (dark) |
| `density` | `compact` |
| `motif` | `ruler` (Word ruler backdrop) |
| `fontPair` | Fraunces (display) + Inter (body) + JetBrains Mono (code) |
| `heroVariant` | `live-demo` (embedded MiniSpreadsheet) |

The Tweaks panel from the prototype must **not** ship.

## Section map (current → target)

| Current | Target | Action |
|---|---|---|
| `nav-bar.tsx` | Header | Restyle, move theme toggle here |
| `hero-section.tsx` | Hero | Add `<MiniSpreadsheet>` right column |
| `demo-section.tsx` (iframe) | Demo (Sheet/Doc tabs) | Rebuild |
| `why-section.tsx` | — | **Drop** (not in handoff) |
| `features-section.tsx` | Feature grid (5 cards) | Restructure |
| `developer-section.tsx` | Code section (4 tabs) | Restructure |
| `opensource-section.tsx` | — | **Fold into Footer** |
| `footer.tsx` | Footer | Restyle, remove theme toggle |
| (new) | Social band | Add |
| (new) | Use cases | Add |
| (new) | Pricing | Add |

## Phases

Each phase = one PR (or one commit if small). Run `pnpm verify:fast` per
phase. Update `docs/design/homepage.md` when structural changes land.

### Phase 0 — Foundation (tokens + fonts) ✅

- [x] Import Fraunces / Inter / JetBrains Mono via Google Fonts in
      `packages/frontend/index.html` (preconnect + `display=swap`).
- [x] Add Butter & Maple light + dark CSS custom properties to
      `packages/frontend/src/index.css` under `--wb-*` namespace. Existing
      `--homepage-*` tokens left intact for incremental migration.
- [x] Register font families in Tailwind `@theme inline`: `font-display`
      (Fraunces), `font-body` (Inter), `font-code` (JetBrains Mono).
      Avoided overriding default `font-mono` to keep editor UI unaffected.
- [x] Type scale utilities — used arbitrary Tailwind values inline
      (`text-[clamp(40px,5.5vw,72px)]` etc.) instead of named utility
      classes. Each section pulls only the sizes it actually consumes.

### Phase 1 — Reusable primitives ✅

- [x] `<RulerBackdrop>` — `app/home/primitives/ruler-backdrop.tsx`. Pattern of
      ticks + baselines + dashed margin guide + radial fade. Opacity
      0.55 light / 0.4 dark via `dark:` variant.
- [x] `<WaffleLogo>` — `app/home/primitives/waffle-logo.tsx`. 28×28 SVG with
      butter rim, syrup-deep border, 3×3 syrup pockets. Wired into NavBar.
- [x] `<WbButton>` — `app/home/primitives/wb-button.tsx`. Pill-shaped
      primary (syrup) + ghost (syrup-bordered) variants in two sizes
      (default / lg). Independent of the existing app `<Button>` so
      editor UI stays unaffected.

### Phase 2 — `<MiniSpreadsheet>` (load-bearing) ✅

- [x] `formula-engine.ts` — pure module exposing `evaluate`, `computeAll`,
      `formatValue`, and the `ORDERS_DATASET` seed. Supports `=A*B` and
      `=SUM(...)` / `=AVG(...)` ranges. Recurses through formula refs.
- [x] `formula-engine.test.ts` — node:test coverage for ORDERS_DATASET
      totals + format helper.
- [x] `<MiniSpreadsheet compact?>` — formula bar (`A1 ƒx <expr>`), grid
      with header / row-num / data / total rows. Click selects, double
      click edits, Enter commits / starts edit, Esc cancels, arrow keys
      and Tab navigate. Berry dot marks formula cells.
- [x] Mounted under existing Hero as a temporary preview so the Phase 2
      checkpoint is visible. Phase 4 will move it into the proper hero
      right column and drop the placeholder.

### Phase 3 — Header + theme toggle ✅

- [x] `<ThemeToggle>` primitive — sun/moon icon button using lucide
      icons + existing `useTheme()`. Reuses the existing
      `ThemeProvider` (`vite-ui-theme` localStorage key + system
      preference fallback already match handoff requirements).
- [x] NavBar rewritten — sticky `top-0`, `backdrop-blur-md`,
      `bg: color-mix(--wb-bg 80% transparent)`, border-bottom appears
      after `scrollY > 8`. Theme toggle + WbButton CTA on the right.
      Mobile hamburger keeps toggle in the dropdown.
- [x] Footer toggle removed (was redundant once it lives in header).

### Phase 4 — Hero ✅

- [x] Two-column hero (`md:grid-cols-[1.05fr_1fr]`, gap 64px). Copy on
      left, `<MiniSpreadsheet compact>` on right. Stacks on `<920px`.
- [x] Eyebrow pill — butter 30% bg, syrup 30% border, leaf glow dot,
      mono `v0.4 · MIT · 4.2k ★`.
- [x] H1 — Fraunces, `clamp(40px,5.5vw,72px)`, italic syrup-deep
      "warm enough" with `<SyrupDrip>` SVG underline.
- [x] Subhead 17–19px with `--wb-sub` color, max-width 540px.
- [x] CTAs — primary "Try the demo" + ghost "npm i wafflebase"
      (CodeIcon) using new `<WbButton>` (size lg).
- [x] Stats row (Bundle / Formulas / License / Deps) — Fraunces 26px
      values + JetBrains Mono uppercase eyebrow labels.
- [x] HeroSheet right column — 0.4deg rotate, syrup-deep drop shadow,
      "live · try editing" pulsing pill anchored to top-right.
- [x] `<RulerBackdrop>` behind hero (radial fade to `--wb-bg`).

### Phase 5 — Feature grid ✅

- Social band dropped — 5 fictional partner logos don't fit a real OSS
  product.
- [x] `<FeatureGlyph kind="…">` — primitive lifting the 5 waffle-pocket
      SVGs from `reference/app.jsx` (reactive / formulas / embed / sync /
      io). All colors swapped to `--wb-*` tokens.
- [x] `<SectionHead kicker title sub>` — primitive for kicker (mono
      uppercase) + Fraunces h2 + sub. Reusable across Phases 6/7/8.
- [x] `features-section.tsx` rewritten — 3 large hero cards with waffle
      glyphs (Real-Time Collab / REST API & CLI / Self-Hosted) + 4
      compact secondary cards with butter-tinted lucide icon chips
      (Formulas / Charts / Docs / Sharing). Cards use `--wb-paper`
      background + `--wb-rule` border + handoff card shadow + hover
      scale 1.005. All existing copy & hrefs preserved.

### Phase 6 — Demo section (Sheet ↔ Doc tabs) ✅

- [x] `<DocPreview>` primitive with toolbar (B/I/U + ¶/H1/{}/2
      collaborators pill), 24-tick mini ruler, sample doc body (Q3
      launch plan), blinking H1 caret (`@keyframes wb-doc-caret`),
      inline `<FormulaToken expr value>` pills (berry ƒ, syrup-deep
      expr, sub arrow, butter-tinted ink value).
- [x] `demo-section.tsx` rewritten — SectionHead, framed card with
      handoff shadow, tab bar with active syrup underline + butter
      file pill + leaf glow "engine ready · 0 ms" status, footer with
      tab-aware hint + `wafflebase@0.3.6` badge.
- [x] Sheet tab keeps the existing live iframe demo (real product
      surface). Doc tab renders `<DocPreview>`. Iframe stays mounted
      across tab switches via display toggling — no reload, no flicker.
- [x] Section copy uses existing product wording (kicker "Live demo",
      title "Try it live", sub "Edit cells, type formulas …").

### Phase 7 — Code section ✅

- [x] `developer-section.tsx` rewritten as a single `--wb-ink` dark code
      card with 2 tabs (REST API / CLI), file-name pills, syrup-tinted
      tab header, butter-colored active tab + bottom border, footer link
      that switches per tab. Existing copy + sample code preserved.
- [x] Token color palette swapped to handoff: comment muted italic /
      string butter / cmd+method berry bold / flag leaf / prompt muted /
      text paper. Tokenizer (`#` comments, `$` prompt, quotes, flags,
      commands, methods) kept intact.
- Tabs reduced from prototype's 4 (npm install / React / vanilla /
  formulas) to 2 (REST API / CLI) — Wafflebase ships REST + CLI as the
  actual integration surfaces, so prototype copy doesn't apply.

### Phase 8 — Use cases / WhySection / OSS / Footer ✅

- Pricing dropped — Wafflebase is OSS, no SaaS pricing.
- [x] `<BigWaffle>` primitive — 4×4 syrup pockets w/ pocket-shade
      gradient, butter pat with knife slices, syrup pour from top-right
      with 3 drip landings. All gradient/filter IDs prefixed `wb-` to
      avoid collision.
- [x] `use-cases-section.tsx` (new) — 3 cards (Internal tools / Customer
      dashboards / Specs & launch plans). Each card has 0n number, butter
      tag pill, 21px Fraunces title, sub copy, "Read the docs →" syrup
      link. Hover lifts -2px. Specs card surfaces the unique Sheets+Docs
      formula linking story.
- [x] WhySection migrated to `--wb-*` tokens. Comparison table now lives
      in a paper card with rule borders + handoff card shadow + leaf
      checkmark / berry cross / butter "Limited" pill.
- [x] OpenSourceSection rebuilt — paper card with grid layout: copy
      (kicker / title / sub / 3 badges / "Star on GitHub" + "Contribute"
      buttons) on the left, BigWaffle illustration on the right. Existing
      copy + badges preserved.
- [x] `<SectionHead>` extended with `align="center" | "left"` prop so
      it can support the OSS section's left-aligned variant.
- [x] Footer migrated to `--wb-*` tokens. Brand block (waffle + tagline)
      + 3 link columns + bottom bar with copyright + GitHub URL.
- [x] page.tsx reordered to handoff sequence:
      Hero → Demo → Features → UseCases → Why → Developers → OpenSource
      → Footer. Root `<main>` now uses `--wb-bg` so light/dark
      transitions are seamless across sections.

### Phase 9 — Polish ✅

- [x] Removed all 14 `--homepage-*` tokens from `index.css` (both light
      and dark) — no remaining usages anywhere in the frontend tree.
- [x] `docs/design/homepage.md` rewritten — Butter & Maple palette, font
      stack, full section catalog, file structure, theme system, and risk
      table reflect the shipping landing page.
- [x] WhySection retained (existing comparison table content) and styled
      with new tokens.
- [x] OpenSourceSection retained and rebuilt with `<BigWaffle>`
      illustration; content folded under the "OSS callout + repo CTA"
      role.
- [x] `pnpm verify:self` passes — all 8 lanes (sheets/docs/frontend/
      backend/cli builds + verify:fast + chunk gate + entropy) green in
      ~82s. No dead code, no doc-staleness violations.

## Open questions resolved

- 4.2k ★ star count — replaced with `v0.3 · Apache-2.0 · Self-hosted`
  copy (factual project signal, no live API call).
- Tweaks panel — confirmed dropped.
- WhySection — confirmed kept (real comparison content not in handoff).

## Post-handoff revisions

After visual review, the user asked for three changes:

1. **Demo section** — dropped fictional `engine ready · 0 ms` status pill
   and `.wb` / `.wbd` file label pills. Tabs are now icon + label only.
2. **Hero mockup felt ambiguous next to the live demo below** — removed
   the right `<MiniSpreadsheet>` column entirely. Hero is now a single
   centered column (max-w 920px). `<MiniSpreadsheet>`, `formula-engine`,
   and the corresponding test file have been deleted.
3. **Demo Doc tab is now a real iframe** — the static `<DocPreview>`
   primitive was replaced with a second live `/shared/{token}` iframe
   (default `08fe575d-…`). Doc iframe mounts lazily on first activation
   to keep initial pageload light.
4. **Dark-mode hero felt flat** — added a subtle warm radial glow
   overlay (syrup-deep 22% gradient) visible only in `.dark`. Lowered
   `<RulerBackdrop>` dark opacity from 0.4 → 0.3.

## Cross-route style unification

The user asked whether `/login` and `/docs` could share the Butter &
Maple identity. Yes:

- **`/login`** rebuilt around the homepage primitives — `--wb-*` background,
  `<WaffleLogo>` + Fraunces wordmark in the header, `<ThemeToggle>` top
  right, `<RulerBackdrop>` motif, paper card with the new shadow, and
  `<WbButton>` for the GitHub auth CTA. Footer link cluster restyled with
  mono code text. `LoginForm` itself uses Fraunces "Welcome back" heading.
- **`/docs` (VitePress)** — `packages/documentation/.vitepress/theme/style.css`
  now maps the full `--vp-c-*` palette onto Butter & Maple (bg/paper, text,
  divider, brand syrup, tip leaf, warning butter, danger berry, button
  brand, code colors). Fonts: Inter (base), JetBrains Mono (mono),
  Fraunces (h1–h4 + hero name). Google Fonts loaded via the VitePress
  `head` config.

## Open questions

- Is the `4.2k ★` star count copy-locked, or should it pull from the live
  GitHub API?
- The handoff says "the Tweaks panel was a design tool — do not ship".
  Confirmed dropping.
- `WhySection` (Wafflebase vs. Google Workspace comparison) is not in the
  handoff — confirm we drop it entirely (vs. moving it to a separate
  page).

## References

- Handoff: `/Users/hackerwins/Downloads/design_handoff_wafflebase_landing/README.md`
- Design doc to update: `docs/design/homepage.md`
- Current code: `packages/frontend/src/app/home/`
