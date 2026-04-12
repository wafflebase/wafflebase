---
title: ui-review-polish-lessons
target-version: 0.3.3
---

# UI Review Polish — Lessons

## Key Decisions

- **Toolbar primitives over full refactor**: extracted `Toolbar`,
  `ToolbarSeparator`, `ToolbarButton` as shared components but kept
  individual button markup in each toolbar. Full migration can be gradual.
- **matchPath over useMatches**: React Router v7 with `<BrowserRouter>`
  doesn't expose `useMatches`. A declarative `ROUTE_TITLES` array with
  `matchPath` achieves the same goal without migrating to the data router.
- **Landing light mode already worked**: CSS custom properties
  (`--homepage-bg` etc.) already had light/dark variants. Only the
  `LimitedBadge` needed `dark:` prefixed colors.

## Pitfalls Encountered

- **Wrong dev server**: multiple repo clones (`wafflesheets`, `waffledocs`,
  `wafflebase`) can have separate dev servers. Always verify which clone
  the `:5173` server belongs to before screenshotting.
- **HMR on lazy routes**: Vite HMR doesn't always update lazy-loaded route
  chunks. Hard-navigating with a cache-bust query param forces a fresh load.

## Verification

- `pnpm verify:fast` passed before commit (pre-commit hook runs it
  automatically).
- Puppeteer screenshots confirmed visual changes across login, landing
  (hero, comparison table, features), and both editor toolbars.
