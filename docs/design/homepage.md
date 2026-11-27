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
- Preserve the existing auth flow ("Start a workspace" → `/login`, or
  "Go to workspace" if already signed in).
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
| JetBrains Mono (400/500) | Code, file names, footer headings, template category chip | `font-code` |

Headings use `font-feature-settings: 'ss01' on, 'ss02' on` (rounded `g`,
alternate `a`) and tightened tracking (`-0.025em` h1, `-0.01em` h2).

Theme system uses the existing class-based Tailwind mechanism (`light` /
`dark` on `<html>`) via `ThemeProvider`. localStorage key
`vite-ui-theme`. Default = `prefers-color-scheme`.

### Page Sections (top to bottom)

| Order | Section | Purpose |
|---|---|---|
| 1 | NavBar | Sticky header, waffle logo, nav links, theme toggle, primary CTA |
| 2 | Hero | Single-column centered layout: Fraunces H1 + sub + CTA pair |
| 3 | DemoSection | Sheets / Docs / Slides tab card — three tabs embed live `/shared/{token}` iframes (Docs + Slides tabs lazy-mount on first activation) with theme sync via `postMessage` |
| 4 | FeaturesSection | 3 hero cards with waffle-pocket glyphs + a ruled two-column list of secondary features (title, one line, arrow; no icon tiles) |
| 5 | UseCasesSection | 3 scenarios (Internal tools / Customer dashboards / Specs & launch plans) |
| 6 | InteropSection | Import/Export format matrix — "no lock-in" paper cards |
| 7 | WhySection | Comparison table vs Google Workspace inside a paper card |
| 8 | DeveloperSection | Single dark code card with REST API / CLI tabs |
| 9 | DesktopSection | Desktop app download (macOS only for now), filled for a Mac visitor; Windows and Linux told it is coming; absent inside the desktop app |
| 10 | OpenSourceSection | Apache-2.0 callout with `<RepoMap>` infographic + Star/Contribute CTAs |
| 11 | Footer | Brand block + 3 link columns + bottom copyright row |

#### NavBar

Sticky header (`top-0 z-50`), backdrop-blur, `--wb-bg` at 80% opacity. Border-bottom
appears only after `scrollY > 8` (subtle scroll affordance). 28×28 `<WaffleLogo>` +
Fraunces "Wafflebase" wordmark. Links: Features / Documentation / GitHub.
Right: `<ThemeToggle>` (sun/moon icon) + primary `<WbButton>` ("Sign in" or
"Go to workspace" depending on auth).

#### Hero

Single column, centered, max-width 920px, padded `pt-20 md:pt-28 pb-14 md:pb-20`.

- Fraunces `clamp(40, 6vw, 68)px` H1: "The office suite *you can own*"
  (true italic 500 + syrup-deep emphasis on the trailing phrase; the italic
  face is loaded explicitly and synthesis is off). `max-w-[20ch]`
  accommodates the shorter title without orphan wraps.
- Sub copy 17–19px, max-width 560px:
  "Sheets, Docs, Slides, Notes and Boards, edited together in real time.
  Run it on your own servers and script it with the REST API and CLI."
- CTA pair: primary "Start a workspace →" (or "Go to workspace →" if signed in)
  + ghost "View on GitHub →".
- Under the CTAs, a quiet sub-colored text link, "Also a desktop app for
  macOS →", to `/#desktop` (see DesktopSection). It is a link to the section
  rather than a third button: the hero has one job. Rendered only for a Mac
  visitor: the first release is macOS-only, so on Windows, Linux, a phone or
  a tablet it would be a nudge toward a build they cannot run. Not rendered
  inside the desktop app either.
- No eyebrow above the H1 and no stats row under it: both read as template
  scaffolding (DESIGN.md bans kickers outright).
- `<RulerBackdrop>` motif behind the copy (opacity 0.55 light / 0.4 dark).

Live product preview lives in the DemoSection directly below — the hero stays
focused on messaging instead of duplicating the demo.

#### DemoSection

Section frame: `--wb-paper` rounded card (18px), syrup-deep drop shadow.

- **Tab bar** — `Spreadsheet` / `Word processor` / `Presentation` icon + label
  tabs, shortened to `Sheet` / `Doc` / `Slides` below `sm` so a phone-width
  bar stays one line tall. Active tab gets butter-tinted `--wb-paper` bg +
  `--wb-syrup` 2px bottom border; inactive uses `--wb-sub` text. Default
  active tab is `sheet`.
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
- **Footer** — tab-aware mono hint text on the left, `wafflebase@${__APP_VERSION__}`
  on the right (Vite injects the version from the root package.json at build
  time) (Slides hint: "Tip: arrow keys navigate — ⌘/Ctrl+Enter to present.").

#### Daily reset

> **Needs Yorkie ≥ 0.7.28.** Before it, `RestoreRevision` failed on every
> real wafflebase document with `[invalid_argument] unsupported element`:
> Yorkie's YSON parser read any plain object with a string `type` field
> (`{type: "sheet"}` tab meta, slides elements) as a typed value
> (yorkie#2364, fixed in yorkie#2365). A MongoDB deployment that once ran
> yorkie#1582 may also still hold its unique index
> `revisions.doc_id_1_project_id_1_label_1`, which yorkie#1587 removed from
> the code but MongoDB keeps: while it exists a document can hold one
> revision per label, so the second "Before restore" safety revision fails
> with `E11000` and the restore never runs. Drop it by hand.

The three demo panes are **editor** share links to real documents, so every
visitor edits the same copy. `packages/backend/src/demo-reset/` puts them back
once a day:

- The good state is a revision — the history panel's "Name current version"
  — **pinned by id** in `WAFFLEBASE_DEMO_RESET_TARGETS` as
  `<shareToken>:<revisionId>` pairs (tokens = the `VITE_DEMO_*_SHARED_TOKEN`
  values).
- Pinned, never looked up by label: `CreateRevision` is not gated by the
  Yorkie auth webhook (see [revision-history.md](revision-history.md)), and
  these are editor links, so any visitor can name a revision `demo-golden`.
  A "newest with the label" rule would restore their content every day.
- Setup: list a token without `:<revisionId>`. It is never restored; at boot
  its newest revisions labelled `WAFFLEBASE_DEMO_RESET_LABEL` (default
  `demo-golden`) are logged with id and creation time. The operator matches
  the time against when they named it, pins the id, and redeploys. Changing
  the example is the same loop.
- Each token resolves through `ShareLinkService.findByToken`, so a revoked
  link or a trashed document simply fails that one reset.
- One in-process `setTimeout`, re-armed after every run, fires at
  `WAFFLEBASE_DEMO_RESET_HOUR_UTC` (default 15 = 00:00 KST). No scheduler
  dependency and no public endpoint. A restart re-arms instead of resetting,
  so a deploy never wipes a demo mid-day. Production runs one replica; with
  more, each restores the same revision to the same result.
- The restore attaches with the document-scoped service token and calls
  `restoreRevision`; connected visitors see the content swap live. One
  document failing never stops the others.
- Measured on a local Yorkie server, a restore reaches an up-to-date client
  as an ordinary `remote-change`, even after 600 changes of graffiti. A
  client that has fallen past the server's snapshot threshold gets a
  `snapshot` event instead, so the sheet, docs and slides stores (and the
  sheet view and pivot hook that subscribe on their own) treat `snapshot`
  like `remote-change`, as board and notes already did. And because the
  restore can remove a tab a visitor added and is viewing, the owner
  spreadsheet editor re-picks its tab on every root change
  (`resolveActiveTabId`), as the share route already did.

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

#### DesktopSection

`id="desktop"`. The desktop app ([desktop-app.md](desktop-app.md)) ships
with every server release, so the links are GitHub's
`releases/latest/download/<asset>` redirect to the universal macOS disk
image, the name `scripts/test/desktop-release.test.mjs` pins. It lives in
`desktop-download.ts` with the platform choice. **macOS only, for now**: the
Windows build is not Authenticode-signed, so the first public release neither
ships nor links it ([desktop-app.md](desktop-app.md) §7); its row returns
with that build.

- Left: left-aligned `<SectionHead>` — "A desktop app for macOS", sub naming
  what it does (opens wafflebase.io or a team's own server through Change
  server…, updates itself). Right: one ruled row for the macOS build — name,
  architecture, the asset filename in mono (it is the real file a visitor
  will see in Downloads), and a `<WbButton>` "Download for macOS".
  Below the rows, "Install notes →" to `/docs/start/desktop`. Unboxed, so it
  does not stack a second paper panel on the OpenSourceSection right below.
- `detectDesktopPlatform()` reads the visitor's platform: client hints
  (`navigator.userAgentData.platform`), then `navigator.platform`, then the
  UA. Only a Mac visitor gets the primary (filled) button. Everyone else gets
  it as a ghost button — never hidden, since a Windows user may be fetching it
  for a Mac — under one honest line: "Windows and Linux versions are coming."
  on Windows, Linux and anything unknown; "Open this page on a Mac to install
  it." on a phone or tablet (including iPadOS, which reports `MacIntel` and is
  told apart by `maxTouchPoints`), so nothing pushes a disk image at an
  iPhone.
- Every link is a plain `<a href>`: the downloads are external and `/docs` is
  a separate VitePress site, which a router `Link` would route into the SPA.
- **Hidden inside the desktop app.** The shell renders this page when signed
  out, and offering the app to someone already in it is noise. The section,
  the hero link and the footer's "Desktop app" entry all go through
  `offerDesktopDownload()` (`desktop-download.ts`), which checks
  `isDesktopShell()`.
- **Hidden until a release carries the app.** `releases/latest/download/…`
  answers 404 before the first release with desktop assets, and the frontend
  deploys from main on merge. So `offerDesktopDownload()` also requires this
  build's version (`__APP_VERSION__`, the root package version) to be at or
  past `FIRST_DESKTOP_RELEASE` (0.6.19): merging early shows nothing, and the
  entry appears with the release that publishes the assets. What is left is
  the time between the version bump landing on main and that release being
  published (the release procedure publishes right after the bump), plus
  the release's own desktop run, about half an hour. The docs guide tells a
  reader who hits a Not Found what it means. After the first such release,
  check the deployed homepage and both download links.

#### OpenSourceSection

`--wb-paper` rounded card with grid layout: copy on the left
(left-aligned `<SectionHead>`, badges, primary "★ Star on GitHub" + ghost
"Contribute →" buttons), `<RepoMap>` infographic on the right.

`<RepoMap>` backs the headline's claim with the repository itself: the
`wafflebase/wafflebase` root under the Facet mark, then a ruled file tree of
the real `packages/*` directories in three groups — Editors (sheets, docs,
slides, notes, board; filled pockets), Server and app (backend, frontend) and
Tools (cli, core; outlined pockets). Package names are mono because they are
code. It replaced `<BigWaffle>`, a butter-and-syrup waffle illustration that
read as clip art next to the one-color mark. Keep its rows in step with the
monorepo.

#### Footer

`--wb-bg` background with rule top border. Two-column layout: brand block
(WaffleLogo + Fraunces wordmark + tagline: "Self-hosted collaborative
presentations, word processor, and spreadsheet, with real-time editing
and a REST API for automation.") + 3-column sitemap (Product / Community
/ Project); Product carries "Desktop app" → `/#desktop`, dropped inside the
desktop app. Bottom bar: copyright + repo URL.

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
    ├── repo-map.tsx                         # OSS section infographic
    ├── feature-glyph.tsx                    # 5-kind feature icon set
    ├── theme-toggle.tsx                     # Sun/moon icon button
    ├── wb-button.tsx                        # Pill-shape primary/ghost buttons
    └── section-head.tsx                     # h2 + sub (center/left), no kicker
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
| Shared demo token expires or data changes | Dedicated demo documents behind editor share links, so visitors' edits accumulate; the backend's `DemoResetService` restores each to an operator-pinned revision once a day (see *Daily reset*) |
