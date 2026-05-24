# `@wafflebase/tokens` — Lessons

Paired with `20260524-tokens-package-todo.md`. Captured as the work proceeded.

## What surprised

- **Backend Jest needs a `moduleNameMapper` entry for every workspace package
  that sheets/docs/slides transitively import.** The existing
  `packages/backend/package.json` already had entries for
  `@wafflebase/{sheets,docs,slides}` resolving to source files. Adding
  `@wafflebase/tokens` was the same pattern — but without it, backend Jest
  fails when running tests that touch sheets, because Jest cannot parse the
  ESM `dist/index.js` shipped by the tokens package.
- **The "factory default" for Slides is split across two files.** The first
  implementer instinctively went to `packages/slides/src/import/pptx/theme.ts`
  (PPTX fallback when `<a:clrScheme>` is missing). The actual seed for new
  decks lives in `packages/slides/src/themes/default-light.ts` (consumed by
  `model/migrate.ts` and `store/memory.ts`). Both ended up migrated; both are
  reasonable points of attack.
- **The doc-staleness lane (`verify:entropy`) treats every backtick string
  that looks like a file as a real reference.** Bare `theme.ts` /
  `tokens.css` / `formatting-colors.ts` mentions in design docs fail the
  check. Use fully qualified `packages/<pkg>/.../<file>` paths from the
  start.
- **`@theme inline` in Tailwind 4 accepts self-referential CSS variables.**
  `--font-display: var(--font-display);` is the documented shadcn pattern
  for routing typography through CSS custom properties. Reads at build
  time, resolves at runtime against `:root`.

## Decisions

- **rgba composition uses RGB tuples from palette, not `color-mix`.** The
  existing index.css used `color-mix(in srgb, var(--wb-butter) 30%, transparent)`
  for sidebar accents. The generated `tokens.css` emits `rgba(244, 201, 93, 0.30)`
  instead. Reason: Canvas-side consumers (sheets selection wash) need a
  composable rgba string, not a CSS function. Functionally equivalent in sRGB.
- **Docs caret/text shifted from `#000000` / `#e0e0e0` to warm Butter & Maple
  ink (`#2A1E12` / `#FBF6EC`).** Browser smoke is deferred to the human
  reviewer. If the warming reads as off-brand for any reason, the fallback is
  to revert just those two keys in `packages/docs/src/view/theme.ts`.
- **Slides built-in `default-light` / `default-dark` themes retain their ids
  and display names** ("Simple Light", "Simple Dark") so stored decks keep
  resolving. Only the color values and font families changed. Other named
  themes (`streamline`, `focus`, `material`) are user-selectable identities
  and stayed untouched.
- **Removed cross-references inside `:root`.** Previously index.css had
  `--primary: var(--wb-syrup)` (a chain). The generated tokens.css emits
  `--primary: #B8651A` directly. The chain is gone but the resolved value is
  identical.
- **Pulled two more cross-package mismatches into this PR after the initial
  scope.** (1) Docs `selectionColor` moved from Google blue (`rgba(66, 133,
  244, 0.3)` light / `rgba(100, 160, 255, 0.35)` dark) to butter
  (`rgba(palette.butterRgb, 0.30)` / `0.35`) so text selection in docs
  reads with the same tone as the cell-range wash in sheets. (2) Docs
  `pageBackground` and `rulerContentBackground` moved from `#ffffff` /
  `#2b2b2b` to `palette.neutrals.{light,dark}.paper` so the "paper sheet"
  surface is warm-cream in both modes, matching the brand neutrals. Other
  chrome grays (`canvasBackground`, `rulerMarginBackground`,
  `headerFooterBorderColor`) stay neutral and will be reconsidered in a
  later PR once a "canvas surfaces" semantic layer is justified by a
  second consumer.

## Contrast measurements

WCAG AA contrast smoke test reported these ratios on the migrated palette:

| Pair                                          | Ratio   | Threshold | Margin |
| --------------------------------------------- | ------- | --------- | ------ |
| `foreground` vs `background` (light)          | 19.89:1 | 4.5       | high   |
| `foreground` vs `background` (dark)           | 19.05:1 | 4.5       | high   |
| `primaryForeground` vs `primary` (light)      | 4.11:1  | 3.0       | tight  |
| `primaryForeground` vs `primary` (dark)       | 6.71:1  | 3.0       | comfy  |
| `sidebarForeground` vs `sidebar` (light)      | 15.08:1 | 4.5       | high   |
| `sidebarForeground` vs `sidebar` (dark)       | 16.64:1 | 4.5       | high   |
| `light.ink` vs `palette.butter` (chip text)   | 12.27:1 | 4.5       | high   |

The 4.11:1 light-mode primary pair (cream `#FFFAF0` on syrup `#B8651A`) is
the weakest. It clears AA-large for chrome and chip text, but a future PR
should look at whether body text ever lands directly on primary buttons —
that would want 4.5:1 minimum.

## Visual diffs (deferred to browser smoke)

The human reviewer should run `pnpm dev`, toggle light/dark, and verify the
four screens listed in the plan Task 5 Step 5:
- Document list (sidebar + header chrome)
- A Docs document (caret + default text warmed)
- A Sheets spreadsheet (active cell ring, header chip, selection wash)
- A Slides deck — new deck should ship with the Butter & Maple accents

## Snapshot refreshes

None of the slides snapshot tests required updating. The two assertion
updates in `packages/slides/test/import/pptx/theme.test.ts` were inline
`.toBe(...)` checks against the old Google-blue fallback constants — those
are not snapshot files, just hardcoded expected values that the tests now
assert against the new tokens-backed defaults.

## Follow-ups for PR #2

- The hardcoded `TEXT_COLORS` / `BG_COLORS` in
  `packages/frontend/src/components/formatting-colors.ts` are the next
  target. Their grid layout makes a swatch generator natural.
- Contrast smoke test infrastructure is now in place
  (`packages/tokens/src/contrast.ts`) — reuse it in PR #2 to validate the
  swatch grid against light and dark backgrounds.
- The `firstFamily(stack)` helper currently duplicated in three slides theme
  files (PPTX fallback, default-light, default-dark) is small enough to leave
  alone for now, but if a fourth caller appears, extract it to
  `packages/slides/src/themes/_helpers.ts`.
