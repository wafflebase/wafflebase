# AI-slop cleanup (Impeccable audit follow-up)

Source: the whole-project Impeccable audit of 2026-11-14
(`.impeccable/audit/2026-11-14T02-09-34Z__project.md`, 12/20). Six steps,
each implemented, reviewed, `pnpm verify:fast` green, then committed. One PR
for the lot, with before/after screenshots.

## 1. Distill — remove the scaffolding that reads as template

- [x] Drop the `kicker` prop from `home/primitives/section-head.tsx` and all 7 call sites
- [x] Drop the hero eyebrow pill and the hero non-metric stats row
- [x] Drop the 01/02/03 numbers on use-case cards
- [x] Replace the 8 same-size secondary feature cards with a ruled list
- [x] Drop the kickers on `/templates` and `/t/:id`
- [x] Analytics: drop the derived "Documents tracked" tile
- [x] DESIGN.md: remove the "brand eyebrows" allowance

## 2. Colorize — one accent, tokens for every chrome color

- [x] Tooltip off the accent (`bg-foreground text-background`)
- [x] A `selected` token distinct from hover; Toggle on-state uses it
- [x] Sidebar hover is a neutral wash, active stays butter
- [x] Selection / handle / guide tokens in `@wafflebase/core`, threaded through slides, sheets object layer, docs image overlay
- [x] Document-type colors from tokens (no purple / fuchsia), paired light/dark
- [x] Chart tokens: a distinguishable series set, no AI purple
- [x] Raw `text-red-500` / `text-green-500` → `destructive` / `success`

## 3. Clarify — copy

- [x] "Failed to X" → "Couldn't X", with cause/recovery where known
- [x] "Please try again later." → a real retry where one exists
- [x] Sentence case for dialog titles, menus, nav, settings headings
- [x] One spelling: "data source"; "Sign in / Sign out"
- [x] Drop "successfully" and title-restating dialog descriptions
- [x] Homepage: replace aphorisms with concrete claims; CTA names the action
- [x] Login: no "Welcome back" for first-time visitors
- [x] CLI root description; docs-site tutorial intros

## 4. Harden — browser surfaces and accessibility

- [x] `index.html`: allow pinch zoom (WCAG 1.4.4) unless an editor needs it
- [x] `::selection`, `color-scheme`, `caret-color`, `accent-color` in the app base layer
- [x] Docs site: syrup focus ring, selection, scrollbars
- [x] Slides canvas context menu themed from tokens, real check icon
- [x] `index.html` meta description + og tags

## 5. Typeset

- [x] Load Fraunces italic for the hero `<em>` (no faux italic)
- [x] Document the 10px micro step; remove 8px; uppercase tracked micro-kickers → sentence case
- [x] Template gallery/landing: no mono as costume

## 6. Polish

- [x] Unicode glyph icons → Tabler (`×`, `↑↓✕`, gradient arrows, `Map ▾`)
- [x] Radius scale in order (`sm` ≠ 0.8px, `xs` ≤ `sm`), dialogs per DESIGN.md
- [x] Board minimap + slides autofit toggle from tokens, no decorative blur
- [x] Docs site: warning ≠ brand color, warm neutral tokens, dead `.VPHero` CSS
- [x] Leftovers: `sidebar.tsx` `hsl(oklch)`, `--font-display` self-reference, hover-only gallery CTA, raw type in review queue

## Review

Six steps, one commit each, plus one commit of whole-branch review fixes.
Every step got an independent review with a rotating lens (correctness,
truthfulness, a11y/touch, security/docs); findings and fixes are logged in
the lessons file.

- `verify:fast` green on every commit.
- `verify:browser:docker`: visual (220/220 after the baseline refresh) and
  interaction pass. One hunt oracle (slides drag landing at y=718 vs 800)
  failed once in Docker and passed on a local rerun of the same branch.
- Google Fonts cache re-recorded (the `css2` URL gained the italic axis);
  baselines updated, each changed one pixel-diffed against `main`: 88
  encoding-only rewrites restored, 24 intended changes kept.
- Before/after screenshots from `main` (`:5173`) and this branch (`:5181`)
  against the same backend; hosted on the assets-only branch
  `pr-assets/impeccable-slop-cleanup` for the PR body.
- Known limitations are listed in the PR body.
