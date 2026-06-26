# Lessons — slides shared editable toolbar parity

## What the bug actually was

The editable share toolbar wasn't gated by a permission check — it was
gated by **missing props**. `SlidesToolbar` renders each right-panel
toggle only when its callback prop exists (`{onToggleThemePanel && …}`),
the zoom control is `disabled={!controller}`, and image Replace is
`disabled={… || !upload}`. The shared layout passed only four props, so
those controls silently vanished. The owner route passed the full set.

**Lesson:** when "feature missing in mode X," diff the *prop sets* at the
two mount sites before assuming a permission/role branch. Optional-prop
gating produces "missing UI" with no `if (role)` anywhere to grep for.

## Chunk isolation beats DRY here

Tempting to export `MOBILE_PANEL_META` / `RightPanel` from
`slides-detail.tsx` and import them. But `shared-document.tsx` serves
sheet + doc + slide share links; importing from the owner route module
would pull the whole heavy slides-editor module into every share chunk.
Re-defining a small constant locally, and lazy-importing the panel
components, keeps the slides editing code out of non-slides chunks. DRY
loses to bundle boundaries for cross-route shared UI.

## verify:fast was already red on main

`cli typecheck` fails on `main` (`exportPptx` not yet exported from
`@wafflebase/slides/node` — in-progress PPTX-export work). Don't assume a
red gate means your change broke it: stash, checkout `main`, re-run the
failing step to attribute the failure before chasing it.

## Frontend has no standalone tsc gate

`verify:fast` typechecks sheets/slides/cli/docs but the frontend relies on
lint + tests + `vite build` (which doesn't run tsc). A raw
`tsc --noEmit` over the frontend surfaces many pre-existing errors from the
wrong config — not a useful signal. Verify frontend type-safety by
matching a known-good reference usage (here: the owner route) and running
eslint, not raw tsc.
