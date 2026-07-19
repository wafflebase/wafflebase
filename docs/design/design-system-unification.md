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

> **Update (superseded location):** the tokens package was later folded into
> `@wafflebase/core` as its `./tokens` subpath — see
> [shared-core-extraction.md](shared-core-extraction.md). Paths below point to
> the current `packages/core/src/tokens/` location; the design intent is
> unchanged.

- Shared tokens (now `@wafflebase/core/tokens`)
  - `packages/core/src/tokens/palette.ts` — raw oklch color constants (Butter &
    Maple, light and dark maps).
  - `packages/core/src/tokens/semantic.ts` — meaning-level tokens (`primary`,
    `surface`, `foreground`, `border`, ...).
  - `packages/core/src/tokens/radius.ts`, `packages/core/src/tokens/typography.ts`.
  - `packages/core/src/tokens/index.ts` — re-exports.
  - `packages/core/scripts/build-css.ts` — generates a CSS-variable
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
  `packages/core/src/tokens/semantic.ts` no longer reference
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

### Toolbar dropdown unification (2026-07 audit)

A follow-up audit compared the toolbar dropdowns across **all four** editors
(Docs / Slides / Notes / Sheets), including the Notes and Sheets toolbars that
shipped after the original roadmap was written (the surface inventory above
predates them). The finding refines the PR #3–#5 plan.

**What is already unified.** Every dropdown *panel* routes through the single
shared `components/ui/dropdown-menu` Radix wrapper and consumes design tokens
(`--popover` / `--accent` / `--border` / `--radius`). Panels, menu items, and
hover/pressed conventions are already consistent. The shared `Toolbar` /
`ToolbarSeparator` / `ToolbarButton` primitives in
`packages/frontend/src/components/ui/toolbar.tsx` also already exist.

**What diverged (the real inconsistencies).**

1. **`ToolbarButton` was dead code.** Nothing imported it; every trigger
   re-inlined the same `h-7 w-7 … hover:bg-muted` string (~26 icon + ~4 menu
   sites), so the shared button height was a convention, not an enforced
   primitive — free to drift.
2. **Container density.** Slides overrode the shared `Toolbar` to `h-10 gap-1`
   (40 px) while Docs / Sheets / Notes use the compact shared default
   (≈36 px, `gap-0.5`). Slides separators also used `mx-1` vs the default `mx-2`.
3. **Notes rolled its own chrome.** A copied container `<div>` plus a custom
   `Divider` (`bg-border`, thinner, lower-contrast) instead of the shared
   `Toolbar` / `ToolbarSeparator`.
4. **Duplicated picker bodies.** Color grids exist three ways
   (`ColorPickerGrid` `grid-cols-8`, slides `ThemedColorPicker` `grid-cols-8`
   + theme roles, `conditional-format-panel` hand-rolled `grid-cols-5`); the
   table picker exists twice (shared `TableGridPicker` with tokens vs slides
   `TablePicker` with hardcoded Google-blue `rgba(26,115,232,…)`).
5. **Missing primitive.** There is no `Popover`; color pickers abuse
   `DropdownMenu` + manual open-state + `useMenuCloseHandlers` focus workarounds.

**Decision — density = compact.** Converge on the shared `Toolbar` default
rather than promoting the 40 px height. Rationale: 3 of 4 editors and the shared
default are already compact, so this is the minimal-blast-radius change (only
Slides shrinks ~4 px). Promoting 40 px would have restyled three shipped
toolbars for one.

#### Phase 1 (this PR — `unify-toolbar-dropdowns`)

- Make `ToolbarButton` the enforced standard: `forwardRef` (so it slots into
  `DropdownMenuTrigger` / `TooltipTrigger asChild`) + `variant: "icon" | "menu"`
  via CVA. The `icon` variant reproduces the existing hand-inlined string
  exactly. The one intentional visual normalization: the alignment dropdown
  trigger moves from its bespoke `gap-0 px-1` to the shared `menu` shape
  (`gap-0.5 px-1.5`) — the ~2px-wider result now matches the Notes / Slides menu
  triggers that were already on that shape, so the divergence is removed rather
  than preserved.
- Adopt it in the **shared** `components/text-formatting/*` group
  (`text-paragraph-group`, `text-format-group`, `insert-link-button`) — this
  propagates the primitive to Docs, Slides, and Sheets at once.
- Fix container divergence #2/#3: drop the Slides `h-10` / `gap-1` / `mx-1`
  overrides; move Notes onto the shared `Toolbar` / `ToolbarSeparator`.

#### Phase 2 (shipped)

- **Button migration + disabled-state standard.** Migrated the remaining
  editor-local raw trigger buttons to `ToolbarButton` (Docs
  `docs-formatting-toolbar`, Sheets `formatting-toolbar`, Slides `toolbar/*`),
  skipping genuinely-different types (primary/Done, split buttons, bordered
  pills, the `min-w` zoom trigger, the export header button). Reconciled the
  disabled convention on `ToolbarButton` to `disabled:pointer-events-none` (the
  shadcn Button/Toggle convention — no hover highlight or not-allowed cursor on
  disabled), which is what the Slides buttons already used.
- **cursor-pointer consistency.** Slides toolbar buttons rendered the default
  arrow cursor on hover (they omitted `cursor-pointer`). Added `cursor-pointer`
  to the shared `Toggle` primitive base (fixes every toggle) and to the
  remaining raw Slides buttons.
- **Selected-item indicator standard.** Single-select "current value" menus
  indicated selection three different ways (native left check in Notes;
  hand-rolled right check in Docs line-spacing / Slides padding; nothing
  elsewhere). Standardized every value menu on the **native Radix left check**
  (`DropdownMenuCheckboxItem`, matching Notes and Google-app convention): Docs
  font family/size, line spacing, text style, alignment (+slim); Sheets number
  format, H/V align; Slides zoom, border weight/dash, table padding. Pure
  **action** menus (borders, arrange, insert, overflow) keep no indicator by
  design; grid-style pickers (`themed-font-picker`, `line-picker`,
  `shape-picker`) keep their ring/bg highlight since they are not menus.
- **Color-swatch a11y.** `ColorPickerGrid` gained an optional `colorKind` prop
  so swatches announce "text color" vs "background/highlight color"; the Slides
  `TablePicker` now wraps the shared `TableGridPicker` (token highlight, no more
  hardcoded blue), and `conditional-format-panel` reuses `ColorPickerGrid`.

Two intentional behavior notes from Phase 2 review, accepted by design: the
menu-trigger `gap-0 px-1 → gap-0.5 px-1.5` normalization, and the shared
`TableGridPicker`'s clamp-to-max-on-edge-exit legend behavior (now shared by
Slides, matching Docs + Notes).

#### Phase 3 (follow-up — deferred)

- Consolidate the color-grid bodies into one component (`ThemedColorPicker`
  superset with optional theme-roles + `ColorPickerGrid`). Overlaps PR #2's
  swatch-generator work.
- Adopt `DropdownMenuShortcut` for the `text-[11px]` shortcut hints and factor
  icon sizes / panel widths into shared constants.
- Add a `Popover` primitive and move the color pickers onto it (overlaps PR #6).

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
| —   | Toolbar dropdown unification (Phase 1) | In progress    | Branch `unify-toolbar-dropdowns`, 2026-07-19; see "Toolbar dropdown unification" above |
| #2  | Palette tokenization                   | Not started  |                                    |
| #3  | Shared toolbar components              | Not started  |                    |
| #4  | Slides toolbar migration               | Not started  |                    |
| #5  | Sheets formatting toolbar              | Not started  |                    |
| #6  | Floating UI consolidation              | Not started  |                    |
| #7  | Mobile first pass for Docs and Sheets  | Not started  |                    |
| #8  | Icon library unification               | Not started  |                    |
| #9  | Type-scale tokenization                | Not started  |                    |
