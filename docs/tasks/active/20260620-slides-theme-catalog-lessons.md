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

## Outcomes

- **Bundle gate:** passed unchanged. `verify:frontend:chunks` stayed
  green after going 5 → 23 themes. Confirmed the pre-flight assumption:
  thumbnails are live-rendered from the `Theme` literal, so themes are
  pure data tree-shaken into the slides chunk — no PNG/SVG assets.
- **Contrast:** all 23 themes passed WCAG-AA (text over both background
  and backgroundAlt) on the first run — **no palette adjustment was
  needed**. The hand-authored palettes were all dark-on-light or
  light-on-dark with comfortable margin.

## Plan gap caught during execution

- The visual-scenario set is defined in **two** places that must stay in
  lockstep: `packages/frontend/src/app/harness/visual/slides-scenarios.tsx`
  (the scenario objects) **and** a hardcoded `scenarioIds` array in
  `packages/frontend/scripts/verify-visual-browser.mjs`. The plan named
  only the first. The Task 5 implementer caught the second; without it the
  Docker baseline-update run would not cover the new scenarios. **Lesson:**
  when retargeting harness visual scenarios, grep the whole `frontend`
  package for the scenario ids — the runner keeps its own allow-list.
  Beware the decoy id `slides-canvas-shapes-catalog-material` (a shapes
  scenario, not the Material theme) — do not remove it.

## Env note

- The Docker visual lane image is amd64 under Rosetta on arm64, which
  produces sub-pixel noise on unrelated scenarios; the overall
  `verify:browser:docker` can exit non-zero from pre-existing drift even
  when the changed scenarios match. Regenerate and commit only the
  in-scope baselines; roll back unrelated churn with `git checkout --`.
