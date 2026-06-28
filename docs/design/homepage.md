---
title: homepage
target-version: 0.4.0
---

# Homepage Landing Page

## Summary

Public-facing landing page for Wafflebase. Introduces the product to first-time
visitors, runs a live in-page demo, and points developers at the REST API / CLI.
Replaces the original "login button only" page for unauthenticated visitors.

The page applies the **Butter & Maple** design system: cream-and-syrup palette,
Fraunces + Inter + JetBrains Mono typography, word-ruler backdrop motif, and
custom waffle-themed illustrations.

## Goals

- Present Wafflebase's value proposition with the locked Butter & Maple
  design language.
- Showcase Sheets, Docs, and Slides as a single cohesive office suite
  via three live iframes (Spreadsheet / Word processor / Presentation)
  inside a tabbed demo card.
- Provide developers with REST API and CLI code examples in a tabbed dark
  card.
- Preserve the existing auth flow ("Get Started Free" → `/login`, or
  "Go to Workspace" if already signed in).
- Support light/dark theme via a single sun/moon toggle in the header,
  honoring `prefers-color-scheme` on first visit.

## Non-Goals

- No SaaS pricing — Wafflebase is OSS, no seats / metering / "talk to sales".
- No fictional partner logo "social band" — would imply trust signals the
  project does not currently have.
- No marketing-only routes (no `/about`, `/blog`, etc.) — the homepage is a
  single scroll surface; deeper content lives under `/docs`.

## Design

### Visual Style — Butter & Maple

CSS custom properties in `packages/frontend/src/index.css`. Colors are hex
values from the locked design handoff. Tokens are mapped into Tailwind via
`@theme inline` (`--color-wb-*`).

```css
/* Light (:root) */
--wb-bg:         #FBF6EC;  /* cream paper background */
--wb-paper:      #FFFDF7;  /* cards, panels, sheet cells */
--wb-ink:        #2A1E12;  /* primary text */
--wb-sub:        #6B584A;  /* secondary text */
--wb-rule:       #E8DCC4;  /* borders, dividers, grid lines */
--wb-syrup:      #B8651A;  /* primary accent (CTAs, links) */
--wb-syrup-deep: #8A4A12;  /* hover, emphasis */
--wb-butter:     #F4C95D;  /* tertiary fill (chips, highlights) */
--wb-berry:      #C2484C;  /* alerts, formula ƒ glyph */
--wb-leaf:       #5A7A3A;  /* success, "engine ready" indicator */

/* Dark (.dark) — see index.css for full table */
--wb-bg:         #1C1610;
--wb-paper:      #241D14;
--wb-ink:        #FBF6EC;
/* syrup brightens to maple-amber, butter stays gold, leaf cools to olive */
```

Typography (Google Fonts, loaded via `index.html`):

| Family | Role | Tailwind utility |
|---|---|---|
| Fraunces (500/600/700) | Display headings, stat values | `font-display` |
| Inter (400/500/600/700) | Body | `font-body` |
| JetBrains Mono (400/500) | Code, kickers, file names | `font-code` |

Headings use `font-feature-settings: 'ss01' on, 'ss02' on` (rounded `g`,
alternate `a`) and tightened tracking (`-0.025em` h1, `-0.01em` h2).

Theme system uses the existing class-based Tailwind mechanism (`light` /
`dark` on `<html>`) via `ThemeProvider`. localStorage key
`vite-ui-theme`. Default = `prefers-color-scheme`.

### Page Sections (top to bottom)

| Order | Section | Purpose |
|---|---|---|
| 1 | NavBar | Sticky header, waffle logo, nav links, theme toggle, primary CTA |
| 2 | Hero | Single-column centered layout: eyebrow + Fraunces H1 + sub + CTA pair + 4 product stats |
| 3 | DemoSection | Sheets / Docs / Slides tab card — three tabs embed live `/shared/{token}` iframes (Docs + Slides tabs lazy-mount on first activation) with theme sync via `postMessage` |
| 4 | FeaturesSection | 3 hero cards with waffle-pocket glyphs + 6 compact secondary cards (3×2, product-balanced: 2 Sheets / 2 Docs / 2 Slides) |
| 5 | UseCasesSection | 3 scenarios (Internal tools / Customer dashboards / Specs & launch plans) |
| 6 | InteropSection | Import/Export format matrix — "no lock-in" paper cards |
| 7 | WhySection | Comparison table vs Google Workspace inside a paper card |
| 8 | DeveloperSection | Single dark code card with REST API / CLI tabs |
| 9 | OpenSourceSection | Apache-2.0 callout with `<BigWaffle>` illustration + Star/Contribute CTAs |
| 10 | Footer | Brand block + 3 link columns + bottom copyright row |

#### NavBar

Sticky header (`top-0 z-50`), backdrop-blur, `--wb-bg` at 80% opacity. Border-bottom
appears only after `scrollY > 8` (subtle scroll affordance). 28×28 `<WaffleLogo>` +
Fraunces "Wafflebase" wordmark. Links: Features / Documentation / GitHub.
Right: `<ThemeToggle>` (sun/moon icon) + primary `<WbButton>` ("Get Started" or
"Go to Workspace" depending on auth).

#### Hero

Single column, centered, max-width 920px, padded `pt-20 md:pt-28 pb-14 md:pb-20`.

- Butter pill eyebrow `v0.3 · Apache-2.0 · Self-hosted` (leaf glow dot).
- Fraunces `clamp(40, 6vw, 68)px` H1: "The Office Suite *You Can Own*"
  (italic + syrup-deep emphasis on the trailing phrase). `max-w-[20ch]`
  accommodates the shorter title without orphan wraps.
- Sub copy 17–19px, max-width 560px:
  "Sheets, Docs, and Slides. Real-time collaboration, REST API, fully
  self-hosted."
- CTA pair: primary "Get Started Free →" (or "Go to Workspace →" if signed in)
  + ghost "View on GitHub →".
- 4 stats: Apache-2.0 / Self-hosted / REST + CLI / Real-time, centered.
- `<RulerBackdrop>` motif behind the copy (opacity 0.55 light / 0.4 dark).

Live product preview lives in the DemoSection directly below — the hero stays
focused on messaging instead of duplicating the demo.

#### DemoSection

Section frame: `--wb-paper` rounded card (18px), syrup-deep drop shadow.

- **Tab bar** — `Spreadsheet` / `Word processor` / `Presentation` icon + label
  tabs. Active tab gets butter-tinted `--wb-paper` bg + `--wb-syrup` 2px
  bottom border; inactive uses `--wb-sub` text. Default active tab is
  `sheet`.
- **Sheet tab** — live iframe `/shared/{VITE_DEMO_SHARED_TOKEN}` (default
  `bed3dbe8-…`). Loaded eagerly on mount.
- **Doc tab** — live iframe `/shared/{VITE_DEMO_DOC_SHARED_TOKEN}` (default
  `08fe575d-…`). Mounted lazily on first activation.
- **Slides tab** — live iframe `/shared/{VITE_DEMO_SLIDES_SHARED_TOKEN}`
  (default `bf4e92f1-…`). Mounted lazily on first activation so the
  initial pageload only fetches the sheet demo. Once mounted, all
  iframes stay alive across tab switches via `display` toggling — no
  reloads.
- **Theme sync** — all three iframes receive `{ type: 'theme-change', theme }`
  via `postMessage` whenever the homepage theme changes; the shared
  `ThemeProvider` inside the iframe applies the change without reload.
- **Footer** — tab-aware mono hint text on the left, `wafflebase@0.3.7` on
  the right (Slides hint: "Tip: arrow keys navigate slides — press F to
  present.").

#### FeaturesSection

Two-tier layout. 3 large cards (waffle-pocket glyphs):

1. Real-Time Collaboration — `sync` glyph
2. REST API & CLI — `embed` glyph
3. Self-Hosted & Open Source — `reactive` glyph

Plus 6 compact cards in a 3×2 grid (`md:grid-cols-2`), product-balanced at
2 per module so the 3-product suite reads visually:

- **Sheets** — Formulas (FunctionSquare), Charts/Pivots/SQL Datasources (BarChart3)
- **Docs** — Page-Based Document Editor (FileText), Comments/Mentions/Spell Check (MessageSquare)
- **Slides** — Themes/Layouts/Shapes (Palette), Animations & Presentation Mode (Presentation)

Each card uses a butter-tinted lucide icon chip. All cards use the handoff
card shadow (`0 1px 0 rgba(42,30,18,0.04), 0 12px 28px -16px
rgba(42,30,18,0.18)`) and hover scale 1.005.

#### UseCasesSection

3-card grid. Each card: `0n` mono number + butter "tag" pill + 21px Fraunces
title + sub copy + "Read the docs →" syrup link. Hover translates -2px.
Cards are: Internal tools (Sheets embed), Pitch decks & all-hands (Slides
theming + self-host), Specs & launch plans (Docs + Sheets references).

#### InteropSection

"No lock-in" format matrix. Two `--wb-paper` cards (handoff card shadow)
inside a `max-w-[760px]` 2-column grid: **Import** (XLSX → Sheets, DOCX →
Docs, PPTX → Slides) and **Export** (DOCX, PPTX, PDF). Each format is a
rule-bordered chip with a lucide file icon. Reflects the shipped
import/export code only — Sheets is import-only (no XLSX export yet), so
it is listed under Import but not Export.

#### WhySection

Wafflebase vs Google Workspace comparison. Inside a `--wb-paper` card with rule
borders. Leaf check / berry cross / butter "Limited" pill markers. The
"single app" row reads "Slides, Docs & Sheets in one app" to match the
3-product suite framing. Import/export differentiation lives in the
dedicated InteropSection above, not in this table.

#### DeveloperSection

Single `--wb-ink` dark card with two tabs (REST API / CLI). Tab header uses
`color-mix(--wb-ink 90% × --wb-syrup-deep)`. Active tab: butter color + butter
underline. Token color palette inside code blocks:

- `comment` → muted italic (`--wb-paper` 38%)
- `string` → `--wb-butter`
- `cmd` / `method` → `--wb-berry` bold
- `flag` → `--wb-leaf`
- `prompt` (`$`) → muted (`--wb-paper` 55%)
- `text` → default (`--wb-paper` 90%)

Footer link toggles between "View full API documentation →" / "View CLI
documentation →" depending on the active tab.

#### OpenSourceSection

`--wb-paper` rounded card with grid layout: copy on the left
(left-aligned `<SectionHead>`, badges, primary "★ Star on GitHub" + ghost
"Contribute →" buttons), `<BigWaffle>` illustration on the right.

The `<BigWaffle>` is a 240×240 SVG: 4×4 syrup pockets with shading gradient,
butter pat with knife-slice marks, syrup pour from top-right with three drip
landings.

#### Footer

`--wb-bg` background with rule top border. Two-column layout: brand block
(WaffleLogo + Fraunces wordmark + tagline: "Self-hosted collaborative
presentations, word processor, and spreadsheet, with real-time editing
and a REST API for automation.") + 3-column sitemap (Product / Community
/ Project). Bottom bar: copyright + repo URL.

### Theme System

| Concern | Implementation |
|---|---|
| Toggle UI | `<ThemeToggle>` icon button in NavBar (sun/moon, lucide) |
| Storage | `localStorage["vite-ui-theme"]` (existing key) |
| Default | `prefers-color-scheme` |
| Mechanism | `light`/`dark` class on `<html>`, applied by `ThemeProvider` |
| Iframe sync | NavBar toggle dispatches via `setTheme()`; DemoSection forwards `{ type: 'theme-change', theme }` to the live iframe via `postMessage`, avoiding reload |

### Routing

Unchanged. `/` resolves through `<HomeOrRedirect>`:

- Authenticated → redirect to default workspace.
- Unauthenticated → render `<HomePage>`.

`/login` route is unchanged.

### Accessibility

- All decorative SVGs (waffle logo, ruler backdrop, big waffle, feature
  glyphs) are marked `aria-hidden="true"`.
- Theme toggle has dynamic `aria-label` ("Switch to light/dark mode").
- All copy meets WCAG AA contrast on Butter & Maple in both light and dark
  themes.
- Iframe has descriptive `title="Wafflebase live demo spreadsheet"`.

### File Structure

```text
packages/frontend/src/app/home/
├── page.tsx                                 # Composes all sections
├── nav-bar.tsx
├── hero-section.tsx
├── demo-section.tsx
├── features-section.tsx
├── use-cases-section.tsx
├── interop-section.tsx
├── why-section.tsx
├── developer-section.tsx
├── opensource-section.tsx
├── footer.tsx
└── primitives/
    ├── waffle-logo.tsx                      # 28×28 logo SVG
    ├── ruler-backdrop.tsx                   # Hero word-ruler motif
    ├── big-waffle.tsx                       # OSS section illustration
    ├── feature-glyph.tsx                    # 5-kind feature icon set
    ├── theme-toggle.tsx                     # Sun/moon icon button
    ├── wb-button.tsx                        # Pill-shape primary/ghost buttons
    └── section-head.tsx                     # Kicker + h2 + sub (center/left)
```

### Dependencies

No new dependencies. Builds on existing TailwindCSS v4, Radix UI, lucide-react,
and the existing `ThemeProvider`.

## Risks and Mitigation

| Risk | Mitigation |
|---|---|
| Google Fonts blocked by network policy | `display=swap` + system serif/sans/mono fallbacks declared in the `--font-*` tokens |
| Iframe blocked by X-Frame-Options / CSP | Same-origin iframe; on iframe `error`, `<DemoFrame>` swaps to an inline message ("Demo unavailable. Try refreshing the page.") instead of a static screenshot, keeping the surface text-only |
| Iframe loads slowly on first visit | `loading="lazy"`, skeleton placeholder while loading |
| Shared demo token expires or data changes | Dedicated demo document with stable read-only content |
