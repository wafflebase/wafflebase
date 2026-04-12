---
title: ui-review-polish
target-version: 0.3.3
---

# UI Review Polish

Follow-up improvements from the 2026-04-11 full-app UI design review.
Work is sequenced small-visible → structural so the user can give feedback
between each item.

## Scope

Landing, login, documents list, spreadsheet editor toolbar, docs editor
toolbar, app shell header, theme coverage.

Out of scope: landing live-demo fallback (production demo is seeded, no
work needed).

## Tasks

- [x] 1. Login card wrapper + micro-links
  - Wrap `login-form.tsx` in shadcn `Card` at ~400px max-width
  - Add footer row with Apache-2.0 / GitHub / Docs links (micro text)
  - Use React Router `Link` for internal navigation
- [x] 2. Landing hero typography + comparison table label unification
  - Apply `text-balance` so hero title breaks cleanly into 2 lines
  - Reorder to "Word Processor & Spreadsheet You Can Own"
  - Unify comparison table cells: icon + themed badge for "Limited"
- [x] 3. Documents list type badge/icon (already implemented)
  - Sheet (green) / FileText (blue) icons already present in `document-list.tsx`
- [x] 4. Spreadsheet formatting toolbar group visual separation
  - Widen separator gaps (`mx-1` → `mx-2`) for clearer logical grouping
- [x] 5. Shared Toolbar primitives extraction
  - Introduce `components/ui/toolbar.tsx` (Toolbar, ToolbarSeparator, ToolbarButton)
  - Refactor `formatting-toolbar.tsx` and `docs-formatting-toolbar.tsx` to use it
  - Ensure same separator spacing tokens across Sheets + Docs
- [x] 6. Header route-based title with matchPath
  - Replace path-string if-else in `app/Layout.tsx` with declarative
    `ROUTE_TITLES` array + `matchPath`
  - Add `document.title` sync across Layout, editor pages, homepage, login
- [x] 7. Landing light mode support
  - CSS custom properties already supported light/dark; only `LimitedBadge`
    needed `dark:` prefixed colors
  - Verified all homepage sections toggle cleanly

## Verification

- `pnpm verify:fast` passed before each commit
- Manual screenshots per task via puppeteer
- User confirmed visually before moving on to next task

## Review Notes

- CodeRabbit review feedback addressed: React Router Link for internal nav,
  ToolbarButton type="button" default, ToolbarSeparator orientation guard,
  aria-hidden on decorative icon, lessons file added.
