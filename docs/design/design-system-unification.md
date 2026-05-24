---
title: design-system-unification
target-version: 0.4.2
---

<!-- Make sure to append document link in design README.md after creating the document. -->

# Design System Unification

## Summary

The UI primitive layer (Radix + shadcn + CVA) is solid, but the editor chrome
— design tokens, toolbars, floating UI, mobile, accessibility — is fragmented
across packages. This document captures a designer-led roadmap that breaks
the unification work into a sequence of PRs.

It serves as the north star for the next several sessions. The Status table
at the bottom is updated whenever a PR lands.

### Goals

- Light/dark toggle produces a coherent palette across all four surfaces:
  frontend chrome, Sheets canvas, Docs canvas, Slides canvas.
- Sheets, Docs, and Slides share a single toolbar design language and a
  shared set of toolbar components.
- Custom floating UI (popovers, context menus) is unified on Radix or
  Floating UI so focus management and accessibility are guaranteed.
- Docs and Sheets gain a first-pass mobile editing flow.
- Icons and typography scale derive from a single token source.

### Non-Goals

- Changes to the canvas rendering engines (GridCanvas, DocCanvas,
  SlideRenderer).
- Brand color redesign. The Butter & Maple palette stays; only its plumbing
  is reorganized.
- Automated visual regression infrastructure. Manual smoke captures suffice
  for this roadmap.
- Component-catalog tooling (Storybook etc.).

## Proposal Details

### Surface inventory

| Area            | Current state                                                          | Primary locations                                                                                          |
| --------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Tokens          | Four sources (frontend `@theme` plus three canvas theme files)        | `packages/frontend/src/index.css`, `packages/sheets/src/view/theme.ts`, `packages/docs/src/view/theme.ts`, `packages/slides/src/model/theme.ts` |
| UI primitives   | Radix + shadcn + CVA, ~22 components                                   | `packages/frontend/src/components/ui/`                                                                     |
| Toolbars        | Per-package: Slides (13 files), Docs (one file), Sheets (none)         | `packages/frontend/src/app/slides/`, `packages/frontend/src/app/docs/`                                     |
| Floating UI     | Radix for dropdown/tooltip; custom inline-positioned popovers elsewhere | `packages/frontend/src/app/docs/docs-link-popover.tsx`, comment popovers                                   |
| Mobile          | Slides only                                                            | `packages/frontend/src/app/slides/mobile-slides-view.tsx`, `packages/frontend/src/app/slides/toolbar/mobile-toolbar.tsx`, `packages/frontend/src/hooks/use-mobile.ts` |
| Icons           | @tabler primary, lucide on the marketing homepage                      | `packages/frontend/src/app/(home)/`                                                                        |

### Roadmap

#### PR #1 — `@wafflebase/tokens` package

Introduce a new `packages/tokens` workspace package and migrate the four
surfaces to consume shared color, radius, and typography tokens from one
source of truth.

- New package `packages/tokens/`
  - `packages/tokens/src/palette.ts` — raw oklch color constants (Butter & Maple,
    light and dark maps).
  - `packages/tokens/src/semantic.ts` — meaning-level tokens (`primary`,
    `surface`, `foreground`, `border`, ...).
  - `packages/tokens/src/radius.ts`, `packages/tokens/src/typography.ts`.
  - `packages/tokens/src/index.ts` — re-exports.
  - `packages/tokens/scripts/build-css.ts` — generates a CSS-variable
    bundle from the TS source, emitted to the package's gitignored dist
    directory at build time.
- Migrations
  - `packages/frontend/src/index.css` — replace the inline `@theme` block
    with `@import "@wafflebase/tokens/tokens.css";` plus component-local
    classes only.
  - `packages/sheets/src/view/theme.ts` — read semantic tokens for shared
    colors. Canvas-only tokens (`formulaRangeBorders`,
    `peerCursorColors`) stay in place but may reference the shared palette.
  - `packages/docs/src/view/theme.ts` — same pattern.
  - `packages/slides/src/model/theme.ts` — the **factory default**
    `ColorScheme` / `FontScheme` is sourced from tokens. The OOXML role
    mapping (`dk1`, `lt1`, `accent1..6`) and tint/shade algorithm stay in
    the slides package. User-edited per-presentation themes always win at
    runtime — tokens are a default provider, not a runtime dispatcher.
- Workspace wiring (five sites): `pnpm-workspace.yaml`, root
  `package.json` scripts, per-package tsconfig references, consumer-package
  `dependencies` blocks, `knip.json`.
- Verification: `pnpm verify:fast`, `pnpm verify:self`, contrast tests
  inside the tokens package, manual light/dark smoke across four screens.
- Risk: low. The same colors arrive via a different path. The slides PPTX
  snapshot tests may need an explicit refresh if the factory default
  changes.
- Done when light/dark toggling produces a coherent tone across frontend
  chrome and all three canvas surfaces.

##### Extensions that landed alongside PR #1

The plan's "non-goals" said only the plumbing would change. Three small
visual changes shipped together because they would have been awkward to
defer once consumers were already migrating:

- **Chrome neutralization.** Sidebar surface/border/foreground in
  `packages/tokens/src/semantic.ts` no longer reference
  `palette.neutrals.*` (warm Butter & Maple). They use shadcn neutral
  oklch values so the editor chrome reads as quiet workbench surface.
  Brand still appears on primary, ring, accent, selection wash, and
  active sidebar item. `palette.neutrals` itself is untouched — still the
  source for Slides factory themes and marketing pages.
- **Docs paper stays pure white.** `pageBackground` and
  `rulerContentBackground` in `packages/docs/src/view/theme.ts` reverted
  to `#ffffff` / `#2b2b2b` after a brief experiment with palette paper
  tones. Caret/text still use `palette.neutrals.{light,dark}.ink` and
  the text selection wash uses butter.
- **Color picker densification.** `TEXT_COLORS` and `BG_COLORS` in
  `packages/frontend/src/components/formatting-colors.ts` grew from 20
  hardcoded Material values to 32 token-aware swatches arranged in 4
  intent-based rows. `ColorPickerGrid` and
  `packages/frontend/src/app/slides/themed-color-picker.tsx` unified to
  8 cols × 20 px. The slides theme row uses `PICKER_THEME_ROLES` (8 main
  OOXML slots) so it shares its grid with the standard row.

These extensions move some of PR #2's surface area earlier. PR #2 still
plans to introduce a contrast-validated swatch generator and remove the
remaining hardcoded hex tail from the formatting-colors module.

#### PR #2 — Color palette tokenization (P0 #3)

Replace the hardcoded `TEXT_COLORS` and `BG_COLORS` palettes in
`packages/frontend/src/components/formatting-colors.ts` with a token-driven
swatch generator.

- WCAG AA contrast (4.5:1) verified automatically for every swatch in both
  light and dark modes.
- The generator is shared between Docs formatting toolbar today and Sheets
  / Slides color pickers tomorrow.
- Depends on PR #1.

#### PR #3 — Shared toolbar components (P0 #2)

Extract reusable toolbar primitives that all three editors can build on.

- `<EditorToolbar>` shell — left/center/right zones, optional sticky.
- `<ToolbarGroup>` — visual separators and optional group label.
- `<ToolbarButton>` — variants (default/active/destructive) with shortcut
  tooltips.
- `<ColorSwatch>` — built on the PR #2 generator.
- Migrate the Docs formatting toolbar first (single file, lowest risk).
- Depends on PR #1, PR #2.

#### PR #4 — Slides toolbar migration

- Port the Slides toolbar shell and the three sections (idle / object /
  text-edit) onto the shared components.
- Domain-specific groups (shape picker, border picker, arrange menu) stay
  inside the slides app code.
- Depends on PR #3.

#### PR #5 — Sheets formatting toolbar

- Sheets currently has no formatting toolbar — all formatting flows through
  context menus and side panels.
- Add a minimal set on top of the shared components: bold/italic/underline,
  alignment, number format, text and background color.
- Depends on PR #3, PR #4.

#### PR #6 — Floating UI consolidation (P1 #4)

- Migrate custom popovers (`docs-link-popover`, `CommentPopover`, others) to
  Radix Popover or `@floating-ui/react`.
- Apply `role`, focus return, and ESC handlers consistently.
- Depends on PR #1 for visual token alignment.

#### PR #7 — Mobile first pass for Docs and Sheets (P1 #5)

- Add bottom-sheet formatting panels for Docs and Sheets, mirroring the
  pattern already proven in Slides.
- Reuse the existing `useIsMobile()` hook.
- Depends on at least PR #3.

#### PR #8 — Icon library unification (P2 #7)

- Replace the marketing homepage's `lucide-react` icons with `@tabler/icons-react`.
- Independent of the other PRs; can be slotted in anywhere.

#### PR #9 — Type-scale tokenization (P2 #8)

- Introduce semantic type tokens (`--text-display-lg`, `--text-body-md`,
  `--text-caption-sm`, ...) and replace ad-hoc Tailwind size classes in
  page-level components.
- Depends on PR #1.

#### Deferred

- P2 #9 canvas visual consistency (selection / cursor / focus-ring
  tokenization).
- Automated visual regression infrastructure.
- Storybook or a `/showcase` route.

### Sequencing rationale

- PR #1 is the foundation; every downstream PR depends on a single token
  source.
- PR #2–#5 produce the most user-visible change (consistent palette and
  toolbars).
- PR #6–#9 are finishing touches and are independent enough to reorder.
- Each PR runs in its own session with a paired
  `docs/tasks/active/<date>-<slug>-todo.md` file.

### Open questions

- The exact split between the slides package and the tokens package for
  per-presentation theme data — resolved during PR #1.
- Whether to introduce automated visual diff after PR #5 — re-evaluate at
  that point.
- How a Sheets formatting toolbar coexists with the existing context-menu
  flow — decided at the start of PR #5.

### Risks and Mitigation

| Risk                                                              | Impact                  | Mitigation                                                                                          |
| ----------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------- |
| Slides PPTX import snapshots break                                | Noisy PR review         | Call out snapshot refreshes in the PR body; confirm the change is intentional during review.        |
| Subtle color drift on canvas surfaces                             | Visual regression       | Attach light/dark before/after captures for four screens; verify oklch equivalence at the boundary. |
| Missed wiring site for the new workspace package                  | Build/test/knip failure | Follow the five-site checklist from `reference_workspace_package_checklist`.                        |
| Toolbar PR balloons in scope                                       | Stalled merge           | Keep PR #3 → #4 → #5 incremental; domain-specific groups stay in their packages.                    |
| User-edited slides themes overwritten by tokens                   | Data loss               | Tokens act only as factory defaults; the per-presentation runtime mapping is untouched.             |

## Status

This table is updated as each PR lands.

| PR  | Title                                  | State        | Notes                              |
| --- | -------------------------------------- | ------------ | ---------------------------------- |
| #1  | `@wafflebase/tokens` package           | Ready to merge | Branch `tokens-package`, 2026-05-24 |
| #2  | Palette tokenization                   | Not started  |                                    |
| #3  | Shared toolbar components              | Not started  |                    |
| #4  | Slides toolbar migration               | Not started  |                    |
| #5  | Sheets formatting toolbar              | Not started  |                    |
| #6  | Floating UI consolidation              | Not started  |                    |
| #7  | Mobile first pass for Docs and Sheets  | Not started  |                    |
| #8  | Icon library unification               | Not started  |                    |
| #9  | Type-scale tokenization                | Not started  |                    |
