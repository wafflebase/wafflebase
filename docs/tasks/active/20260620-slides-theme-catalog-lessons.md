# Slides Theme Catalog — Lessons

## Process

- Root cause of "brand melted into themes" was concrete:
  `default-light.ts` / `default-dark.ts` bind accents to
  `@wafflebase/tokens` `palette.syrup/butter/berry/leaf`. Element colors
  store `{ kind: 'role' }`, so the brand palette renders on every
  role-bound element of every new deck. The fix is data-only; the model
  (`Theme`, flat picker) already supports an arbitrary number of themes.

## Gotchas

- Theme thumbnails are **live-rendered** from the `Theme` literal
  (`theme-thumbnail.tsx`) — no PNG/SVG assets — so adding themes costs ~0
  bundle/asset. Confirmed before sizing the expansion.
- De-branding `default-light` is **not lossless**: existing decks'
  role-bound colors shift (syrup → neutral blue). This is intended, but
  must be called out as a migration note, not hidden.
- `verify-entropy.mjs` doc-ref check (`scripts/verify-entropy.mjs`) only
  scans **top-level** `docs/design/*.md` (non-recursive readdir), so
  `docs/design/slides/*.md` backtick refs are not gated — but the
  `docs/design/README.md` link to the new doc **is** gated and must
  resolve. Keep planned/not-yet-existing files out of backtick
  `name.ext` form anyway, for honesty.

## To fill at completion

- Bundle-gate delta after 23 literals.
- Any contrast failures found by the AA check and how palettes were
  adjusted.
