# Slides on homepage + documentation site

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Design docs to update (same PR):**
- [`docs/design/homepage.md`](../../design/homepage.md)
- [`docs/design/docs-site.md`](../../design/docs-site.md)

**Goal:** Reframe the homepage and documentation site from a 2-product
("Word Processor & Spreadsheet") narrative to a 3-product office-suite
narrative that includes Slides. Add a live Slides demo tab, refresh the
hero, add Slides-focused feature/use-case cards, and ship 3 new
Slides documentation pages.

**Out of scope (intentional deferrals):**

- Slides REST API / CLI surfaces (does not exist yet — DeveloperSection
  stays Sheets-only).
- Additional Slides docs pages beyond the v1 three (`shapes-and-connectors`,
  `presentation-mode`, etc. are follow-ups in their own PRs).
- Live Sheets-cell embedding inside slides (feature not implemented —
  UseCase card copy must not promise it).
- NavBar / OpenSourceSection / DeveloperSection / index.html / routing /
  ThemeProvider — unchanged.

**Visual decisions locked during brainstorming:**

| Decision | Value |
|---|---|
| Hero H1 | "The Office Suite You Can Own" |
| Hero sub | "Sheets, Docs, and Slides. Real-time collaboration, REST API, fully self-hosted." |
| Demo tab order | Sheets → Docs → Slides |
| Demo default active | Sheets |
| Slides demo token (env default) | `bf4e92f1-f289-43dd-be1b-8a47c14f0e7a` |
| Slides demo env var | `VITE_DEMO_SLIDES_SHARED_TOKEN` |
| Features grid | 6 secondary cards, product-balanced 2/2/2 |
| Removed card | "Sharing & Permissions" (overlaps Real-Time Collab hero card) |
| Added Docs card | "Tables & Pagination" |
| Added Slides cards | "Themes & Layouts" + "Presentation Mode" |
| UseCase swap | Card 2 ("Customer dashboards") → Slides pitch-deck case |
| WhySection row | "Sheets & Docs in one app" → "Slides, Docs & Sheets in one app" |
| Footer brand copy | "presentations, word processor, and spreadsheet" |
| Stats | unchanged (Apache-2.0 / Self-hosted / REST + CLI / Real-time) |
| Docs pages added | `slides/build-a-deck.md`, `slides/themes-and-layouts.md`, `slides/keyboard-shortcuts.md` |
| Docs nav/sidebar position | After "Docs", before "Developers" |

---

## Chunk 1: Slides demo iframe

### Task 1: Add Slides tab to DemoSection

**Files:**
- Modify: `packages/frontend/src/app/home/demo-section.tsx`
- Modify (env types): `packages/frontend/src/vite-env.d.ts` (if it declares the existing demo tokens; otherwise skip)
- Modify (env example): `packages/frontend/.env.example` (if it documents `VITE_DEMO_SHARED_TOKEN`; otherwise skip)

Extend the existing 2-tab pattern to 3 tabs. Reuse the lazy-mount +
`display`-toggle pattern from the Docs tab so Slides mounts only on
first activation. Default active tab stays `sheet`.

- [ ] **Step 1: Read demo-section.tsx and confirm current structure**

  Confirm `TAB_ORDER: Tab[] = ["sheet", "doc"]` and that the Doc tab uses
  lazy mounting via `docMounted`.

- [ ] **Step 2: Extend the Tab type and TAB_ORDER**

  ```typescript
  type Tab = "sheet" | "doc" | "slides";
  const TAB_ORDER: Tab[] = ["sheet", "doc", "slides"];
  ```

- [ ] **Step 3: Add the Slides token constant**

  ```typescript
  const DEMO_SLIDES_TOKEN =
    import.meta.env.VITE_DEMO_SLIDES_SHARED_TOKEN ??
    "bf4e92f1-f289-43dd-be1b-8a47c14f0e7a";
  ```

- [ ] **Step 4: Mirror the Doc lazy-mount and state pattern for Slides**

  - Add `slidesIframeRef`, `slidesMounted` (lazy), `slidesState` ("loading" | "loaded" | "error").
  - Add `slidesUrl` locked at first render (mirroring `docUrl`).
  - Extend `useEffect(... tab === "doc" → setDocMounted(true))` to also handle `"slides" → setSlidesMounted(true)`.
  - Extend the theme-sync `useEffect` to call `postTheme(slidesIframeRef, slidesState === "loaded", resolvedTheme)`.

- [ ] **Step 5: Add a third `<DemoTab>` to the tablist**

  Order: `Spreadsheet` → `Word processor` → `Presentation` (label).
  Use a new `<SlidesIcon>` helper (small SVG, 14×14) matching the
  Sheet/Doc icon style — a rounded rectangle with a triangular play
  glyph or a single horizontal text line.

- [ ] **Step 6: Add a third `<DemoFrame>` inside the tab body**

  Gated behind `{slidesMounted && (...)}`. Wire `visible={tab === "slides"}`,
  `iframeRef={slidesIframeRef}`, `src={slidesUrl}`, `title="Wafflebase
  live demo presentation"`, `panelId="demo-panel-slides"`,
  `tabId="demo-tab-slides"`.

- [ ] **Step 7: Update the footer tip copy**

  Extend the ternary so each tab has its own tip. Suggested:
  - sheet: existing copy
  - doc: existing copy
  - slides: "Tip: arrow keys navigate slides — press F to present."

- [ ] **Step 8: Verify keyboard tab navigation still works**

  `handleTabKey` already uses `TAB_ORDER` length, so adding a third entry
  is automatic. Manually verify ←/→ wraps through all three tabs.

- [ ] **Step 9: Add the env var to the .env.example (if one exists for frontend)**

  Document `VITE_DEMO_SLIDES_SHARED_TOKEN` next to the existing two
  tokens. Default in code is the brainstorming-confirmed token, so the
  env var is optional.

- [ ] **Step 10: Manual smoke**

  `pnpm dev` → unauthenticated `/` → DemoSection shows three tabs.
  Click Slides → loads `/shared/bf4e92f1-…`, shows slide content. Switch
  back to Sheets, Docs, Slides — no reloads. Toggle theme — all three
  iframes pick up the change without reloading.

- [ ] **Step 11: Commit**

  ```bash
  git add packages/frontend/src/app/home/demo-section.tsx
  git commit -m "Add Slides tab to homepage DemoSection"
  ```

---

## Chunk 2: Hero + Footer copy refresh

### Task 2: Update Hero H1, sub, and Footer brand copy

**Files:**
- Modify: `packages/frontend/src/app/home/hero-section.tsx`
- Modify: `packages/frontend/src/app/home/footer.tsx`

- [ ] **Step 1: Rewrite Hero H1**

  Replace the existing two-line H1 with:

  ```tsx
  <h1
    className="font-display font-semibold text-[color:var(--wb-ink)] leading-[1.04] tracking-[-0.025em] text-[clamp(40px,6vw,68px)] m-0 mb-6 max-w-[20ch]"
    style={{ fontFeatureSettings: "'ss01' on, 'ss02' on" }}
  >
    The Office Suite{" "}
    <em className="font-medium italic text-[color:var(--wb-syrup-deep)]">
      You Can Own
    </em>
  </h1>
  ```

  Note the `max-w-[20ch]` (was `16ch`) — "The Office Suite You Can Own"
  is 27 characters vs 36 for the previous title, so the constraint
  relaxes. Verify wrapping in dev at 320px / 768px / 1280px viewports.

- [ ] **Step 2: Rewrite Hero sub**

  ```tsx
  <p className="text-[color:var(--wb-sub)] leading-[1.55] text-[clamp(17px,1.4vw,19px)] max-w-[560px] m-0 mb-10">
    Sheets, Docs, and Slides. Real-time collaboration, REST API,
    fully self-hosted.
  </p>
  ```

- [ ] **Step 3: Update Footer brand copy**

  In `footer.tsx`, replace the brand paragraph:

  ```tsx
  <p className="text-[14px] leading-[1.55] text-[color:var(--wb-sub)] max-w-[280px] m-0">
    Self-hosted collaborative presentations, word processor, and
    spreadsheet, with real-time editing and a REST API for automation.
  </p>
  ```

- [ ] **Step 4: Manual smoke**

  `pnpm dev` → check Hero copy at multiple viewport widths. Confirm
  no awkward orphan wrap on the H1 italic emphasis. Check Footer too.

- [ ] **Step 5: Commit**

  ```bash
  git add packages/frontend/src/app/home/hero-section.tsx \
          packages/frontend/src/app/home/footer.tsx
  git commit -m "Reframe homepage hero + footer as 3-product suite"
  ```

---

## Chunk 3: FeaturesSection — 6 product-balanced cards

### Task 3: Rebuild the secondary feature grid

**Files:**
- Modify: `packages/frontend/src/app/home/features-section.tsx`

Drop "Sharing & Permissions", add "Tables & Pagination" (Docs),
"Themes & Layouts" (Slides), "Presentation Mode" (Slides). Reorder
to group by product.

- [ ] **Step 1: Update lucide imports**

  Replace the `Shield` import with the new icons. Final import:

  ```typescript
  import {
    BarChart3,
    FileText,
    FunctionSquare,
    Palette,
    Presentation,
    Rows3,
  } from "lucide-react";
  ```

  (`Shield` was used by "Sharing & Permissions" — removed.)

- [ ] **Step 2: Replace SECONDARY_FEATURES**

  ```typescript
  const SECONDARY_FEATURES: SecondaryFeature[] = [
    {
      Icon: FunctionSquare,
      title: "Google Sheets-Compatible Formulas",
      description: "SUM, VLOOKUP, IF, and cross-sheet references",
      href: "/docs/sheets/formulas",
    },
    {
      Icon: BarChart3,
      title: "Charts & Pivot Tables",
      description: "Built-in data visualization and aggregation",
      href: "/docs/sheets/charts",
    },
    {
      Icon: FileText,
      title: "Page-Based Document Editor",
      description: "Write and format documents with a clean, paginated editor",
      href: "/docs/docs-editor/writing-a-document",
    },
    {
      Icon: Rows3,
      title: "Tables & Pagination",
      description:
        "Rich tables, page breaks, and pagination for long-form documents",
      href: "/docs/docs-editor/writing-a-document",
    },
    {
      Icon: Palette,
      title: "Themes & Layouts",
      description:
        "Four-tier theme system and Google-Slides-parity layouts for decks",
      href: "/docs/slides/themes-and-layouts",
    },
    {
      Icon: Presentation,
      title: "Presentation Mode",
      description:
        "Full-screen player with keyboard navigation and click-to-advance",
      href: "/docs/slides/build-a-deck",
    },
  ];
  ```

- [ ] **Step 3: Verify the grid still renders cleanly**

  The existing JSX uses `md:grid-cols-2 gap-3 md:gap-4`. Six cards in a
  two-column grid renders as 3 rows of 2 — no markup change needed.
  Spot-check at 768px / 1280px breakpoints.

- [ ] **Step 4: Manual smoke**

  Hover each card → shadow + scale animation works. Click each card →
  navigates to the correct `/docs/...` path (some pages don't exist
  yet — that's expected; Chunk 5 ships them).

- [ ] **Step 5: Commit**

  ```bash
  git add packages/frontend/src/app/home/features-section.tsx
  git commit -m "Rebalance feature cards across Sheets, Docs, Slides"
  ```

---

## Chunk 4: UseCasesSection + WhySection copy

### Task 4: Swap card 2 to a Slides pitch-deck case and update WhySection row

**Files:**
- Modify: `packages/frontend/src/app/home/use-cases-section.tsx`
- Modify: `packages/frontend/src/app/home/why-section.tsx`

UseCase card 2 ("Customer dashboards") is a near-duplicate Sheets case.
Replace it with a Slides case. Copy must NOT promise live Sheets-cell
embedding inside slides (feature not implemented).

- [ ] **Step 1: Replace USE_CASES[1] in use-cases-section.tsx**

  ```typescript
  {
    tag: "Pitch decks & all-hands",
    title: "Ship the deck on your brand, not Google's",
    body: "Four-tier theme system, Google-Slides-parity layouts, and a self-hosted store — your team's decks live where your data lives.",
    href: "/docs/slides/build-a-deck",
  },
  ```

  Leave cards 0 and 2 unchanged.

- [ ] **Step 2: Update the WhySection comparison row**

  In `why-section.tsx`, find the row labeled `"Sheets & Docs in one
  app"` and rewrite the label to `"Slides, Docs & Sheets in one app"`.
  Wafflebase column stays `<CheckMark />`. Google Workspace column
  stays `<CheckMark />` (they do offer all three).

- [ ] **Step 3: Manual smoke**

  `pnpm dev` → scroll through UseCasesSection. Card 2 reads as a Slides
  case, links to `/docs/slides/build-a-deck`. WhySection row reads
  correctly.

- [ ] **Step 4: Commit**

  ```bash
  git add packages/frontend/src/app/home/use-cases-section.tsx \
          packages/frontend/src/app/home/why-section.tsx
  git commit -m "Add Slides use-case and update suite comparison row"
  ```

---

## Chunk 5: Documentation site — Slides section

### Task 5: Add Slides nav/sidebar entries to VitePress config

**Files:**
- Modify: `packages/documentation/.vitepress/config.ts`

- [ ] **Step 1: Add Slides to the top `nav`**

  Insert after the "Docs" entry, before "Developers":

  ```typescript
  { text: "Slides", link: "/slides/build-a-deck" },
  ```

- [ ] **Step 2: Add Slides group to the `sidebar`**

  Insert a new group object after the existing "Docs" group:

  ```typescript
  {
    text: "Slides",
    items: [
      { text: "Build a Deck", link: "/slides/build-a-deck" },
      {
        text: "Themes & Layouts",
        link: "/slides/themes-and-layouts",
      },
      {
        text: "Keyboard Shortcuts",
        link: "/slides/keyboard-shortcuts",
      },
    ],
  },
  ```

- [ ] **Step 3: Commit (config-only, before content lands)**

  ```bash
  git add packages/documentation/.vitepress/config.ts
  git commit -m "Docs: add Slides nav and sidebar entries"
  ```

### Task 6: Write `slides/build-a-deck.md`

**Files:**
- Create: `packages/documentation/slides/build-a-deck.md`

Counterpart to `sheets/build-a-budget.md`. End-to-end tutorial:
create a slides document → apply a theme → add a layout-based slide
→ insert and edit a text placeholder → add a shape → use Present mode.

- [ ] **Step 1: Read `packages/documentation/sheets/build-a-budget.md` to mirror its tone, length, and section structure.**

- [ ] **Step 2: Draft the page with these sections**
  - One-paragraph intro: what you'll build (a 3-slide intro deck)
  - "Create a new presentation" — Workspace → New → Presentation
  - "Pick a theme" — apply one of the built-in themes; reference the 4-tier theme model briefly
  - "Add a title slide" — pick a layout (Title slide); fill placeholders
  - "Add a content slide" — Title + Body layout; bullet text
  - "Add a shape" — toolbar Shape menu, drag to size, apply theme color
  - "Present" — F key to enter, ← / → to navigate, Esc to exit
  - "Next steps" — link to Themes & Layouts page and Keyboard Shortcuts page

- [ ] **Step 3: Sanity-check screenshots / asset references**

  This first pass can ship without screenshots if needed — a follow-up
  PR adds them. If screenshots ARE added, drop them in
  `packages/documentation/public/slides/` and reference with
  `![](/slides/build-a-deck-step3.png)`.

- [ ] **Step 4: Commit**

  ```bash
  git add packages/documentation/slides/build-a-deck.md \
          packages/documentation/public/slides/   # only if screenshots added
  git commit -m "Docs: add Slides 'Build a Deck' tutorial"
  ```

### Task 7: Write `slides/themes-and-layouts.md`

**Files:**
- Create: `packages/documentation/slides/themes-and-layouts.md`

Reference doc covering the theme model (without exposing internal
architecture detail) and the available layouts.

- [ ] **Step 1: Read `docs/design/slides/slides-themes-layouts-import.md`** as the authoritative source.

- [ ] **Step 2: Draft user-facing sections**
  - "What is a theme?" — colors, fonts, background; one-paragraph intro
  - "Built-in themes" — short visual catalog (table or grid of theme names + screenshot thumbnails if available)
  - "Switching themes" — toolbar / sidebar action
  - "Layouts" — table of the 11 Google-Slides-parity layouts with name + a one-line "use this for…" description
  - "Changing a slide's layout" — context menu / split-button on the toolbar
  - "Placeholders" — what they are, how they retain their type on layout change

  Keep architecture and CRDT detail in the design doc — this page is
  for end users.

- [ ] **Step 3: Commit**

  ```bash
  git add packages/documentation/slides/themes-and-layouts.md
  git commit -m "Docs: add Slides 'Themes & Layouts' reference"
  ```

### Task 8: Write `slides/keyboard-shortcuts.md`

**Files:**
- Create: `packages/documentation/slides/keyboard-shortcuts.md`

Tabular catalog. Pattern matches `sheets/keyboard-shortcuts.md` and
`docs-editor/keyboard-shortcuts.md`.

- [ ] **Step 1: Read `docs/design/slides/slides-keyboard-shortcuts.md`** to ensure the catalog matches the shipped shortcuts (it explicitly mentions a single catalog source — use it as the source of truth).

- [ ] **Step 2: Draft a table grouped by category**
  - Selection & navigation
  - Editing (text, shapes)
  - Insert (shapes, text box, image)
  - Slide ops (new slide, duplicate, delete, reorder)
  - View (zoom, fit, present)
  - History (undo, redo)

  Cross-platform: list both Cmd and Ctrl where they differ. Mirror the
  format of the existing Sheets/Docs shortcut pages so cross-product
  parity is visible.

- [ ] **Step 3: Commit**

  ```bash
  git add packages/documentation/slides/keyboard-shortcuts.md
  git commit -m "Docs: add Slides keyboard shortcuts reference"
  ```

---

## Chunk 6: Design doc updates

### Task 9: Update `docs/design/homepage.md`

**Files:**
- Modify: `docs/design/homepage.md`

Bring the design doc in sync with the shipped changes so the doc is
authoritative again.

- [ ] **Step 1: Update Summary + Goals to mention three products**

- [ ] **Step 2: Update the Page Sections table description for DemoSection** — "Sheet/Doc tab card" → "Sheets / Docs / Slides tab card (3 live iframes)"

- [ ] **Step 3: Rewrite the Hero subsection's title/sub quotation**

- [ ] **Step 4: Rewrite the DemoSection subsection**
  - Mention the third tab and the `VITE_DEMO_SLIDES_SHARED_TOKEN` env var
  - Document that Slides mounts lazily, mirroring Docs

- [ ] **Step 5: Rewrite FeaturesSection's "4 compact cards" → "6 compact cards (3×2, product-balanced)"** and list the new card titles

- [ ] **Step 6: Rewrite UseCasesSection's card list**

- [ ] **Step 7: Update WhySection's comparison-row example**

- [ ] **Step 8: Update Footer brand copy excerpt**

### Task 10: Update `docs/design/docs-site.md`

**Files:**
- Modify: `docs/design/docs-site.md`

- [ ] **Step 1: Update the package structure tree** to include `slides/`

- [ ] **Step 2: Update the VitePress Configuration section** to mention the new nav/sidebar group (order: Guide / Sheets / Docs / Slides / Developers)

- [ ] **Step 3: Update Content Outline** with a new "Slides section" subsection listing the three pages

- [ ] **Step 4: Commit design docs in one go**

  ```bash
  git add docs/design/homepage.md docs/design/docs-site.md
  git commit -m "Update homepage + docs-site design docs for Slides"
  ```

---

## Chunk 7: Verify, smoke, PR

### Task 11: Pre-commit verify

- [ ] **Step 1: Run the fast verify gate**

  ```bash
  pnpm verify:fast
  ```

  Expected: PASS.

- [ ] **Step 2: Build the documentation site**

  ```bash
  pnpm --filter @wafflebase/documentation build
  ```

  Expected: PASS — no broken links from sidebar/nav to the new pages.
  Confirm `.vitepress/dist/slides/build-a-deck.html` (and the other two)
  exist.

- [ ] **Step 3: Build the frontend**

  ```bash
  pnpm --filter @wafflebase/frontend build
  ```

  Expected: PASS — no missing icon imports, no TS errors.

### Task 12: Manual smoke

- [ ] **Step 1: Homepage in `pnpm dev`**
  - Unauthenticated `/` renders the new Hero copy.
  - DemoSection: three tabs, default Sheets, Slides lazy-mounts, theme sync works on all three.
  - FeaturesSection: 6 cards, 3×2 grid, all six link to `/docs/...`.
  - UseCasesSection: card 2 reads as the Slides pitch-deck case.
  - WhySection comparison row reads "Slides, Docs & Sheets in one app".
  - Footer brand copy includes "presentations, word processor, and spreadsheet".

- [ ] **Step 2: Documentation site in `pnpm --filter @wafflebase/documentation dev`**
  - Top nav has "Slides" between "Docs" and "Developers".
  - Sidebar shows the Slides group with three items.
  - Each new page renders, links to each other work, code samples (if any) format correctly.

- [ ] **Step 3: Click-through from homepage to docs**
  - Homepage feature cards → docs pages
  - UseCase 2 → `/docs/slides/build-a-deck`
  - Verify these resolve (frontend serves `/docs/*` from copied VitePress build per `docs/design/docs-site.md`).

### Task 13: Self code review

- [ ] **Step 1: Dispatch `/code-review` over the branch diff**

  Apply blocking findings; note non-blocking as known limitations.

### Task 14: Open PR

- [ ] **Step 1: Rebase on `origin/main`**

  ```bash
  git fetch origin
  git rebase origin/main
  ```

- [ ] **Step 2: Push and open PR**

  Title (≤70 chars): `Add Slides to homepage and documentation site`

  Body:
  ```markdown
  ## Summary

  - Reframe homepage as a 3-product office suite: new Hero copy
    ("The Office Suite You Can Own"), live Slides tab in DemoSection
    (Sheets → Docs → Slides, default Sheets), and a 6-card
    product-balanced FeaturesSection.
  - Swap UseCase card 2 to a Slides pitch-deck case; update WhySection
    comparison row and Footer brand copy.
  - Add 3 new documentation pages — Build a Deck, Themes & Layouts,
    Keyboard Shortcuts — under a new `slides/` group in the VitePress
    site.
  - Refresh `docs/design/homepage.md` and `docs/design/docs-site.md` to
    match.

  ## Test plan

  - [x] `pnpm verify:fast`
  - [x] `pnpm --filter @wafflebase/documentation build` (no broken links)
  - [x] `pnpm --filter @wafflebase/frontend build`
  - [x] Manual: homepage at 320 / 768 / 1280 px viewports
  - [x] Manual: theme toggle propagates to all three demo iframes
  - [x] Manual: Slides tab lazy-mounts on first activation; no reload on tab switch
  - [x] Manual: docs site nav/sidebar shows Slides group; all three pages render
  ```

### Task 15: Post-merge cleanup

- [ ] **Step 1: Write the lessons file**

  Create `docs/tasks/active/20260521-slides-homepage-docs-lessons.md`
  with any surprises encountered (e.g., copy wrapping at a tricky
  breakpoint, an unexpected iframe reload, a VitePress sidebar quirk).
  One short note per lesson; skip if nothing notable.

- [ ] **Step 2: Archive + reindex**

  ```bash
  pnpm tasks:archive
  pnpm tasks:index
  ```

- [ ] **Step 3: Commit + push the archive move**

  ```bash
  git add docs/tasks/
  git commit -m "Archive 20260521-slides-homepage-docs task"
  git push
  ```
