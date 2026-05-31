---
title: Slides connector elbow/curved routing — lessons
status: active
---

# Lessons

## Importer correctness ≠ renderer correctness

The PPTX importer correctly mapped `curvedConnector*` → `routing:
'curved'` and `bentConnector*` → `'elbow'` since PR1 shipped. The
visible-in-prod bug was a renderer that ignored `el.routing` and
always called `routeStraight`. Importer-side tests would not have
caught it; the gap was at the renderer dispatch.

**How to apply:** When an importer parses a field, add at least one
renderer-side test that exercises a non-default value end-to-end. The
"importer writes X" and "renderer reads X" claims need to meet
somewhere.

## OOXML "exit direction" semantics

For a connector endpoint, "exit angle" is the direction the path
leaves the endpoint. When traversing a→b along the path:
- Near a, motion ≈ aDir.
- Near b, motion ≈ -bDir (opposite of b's exit).

For parallel-opposite endpoints facing away (e.g. a east of b with
aDir=E, bDir=W) the path must wrap around so the final segment into b
moves *east* (opposite of W). My first elbow layout used a symmetric
mid-perpendicular cross-leg, which forced a diagonal closing segment
— invalid for an axis-aligned elbow. A 5-point asymmetric U with the
cross-leg sitting at b.perp keeps every segment axis-aligned at the
cost of visual symmetry; tests assert this exact topology.

**How to apply:** When designing routing topologies, always trace the
last segment's direction against the endpoint's exit constraint —
otherwise the L/Z/U shape "looks right" while still violating the
elbow invariant.

## Floating-point in canvas spy assertions

`Math.cos(Math.PI / 2)` is `6.12e-17`, not 0. `toHaveBeenCalledWith`
does strict equality so it fails. For deterministic-but-not-exact
trig outputs use destructuring + `toBeCloseTo` per argument instead
of one full-array match.

**How to apply:** Default to `toBeCloseTo` for any test that feeds
trig values into canvas calls.

## Dropdown widths must accommodate longest label

The `<LinePicker />` dropdown shipped at `w-[160px]` with two short
labels (Line, Arrow). Adding "Elbow connector" (15ch) and "Curved
connector" (16ch) made the labels wrap onto two lines without any
build-time warning. Tailwind `w-[…]` is a hard cap; the text wraps
silently.

**How to apply:** When extending a fixed-width dropdown / menu /
chip list with a longer entry, either bump the width to fit the
longest label OR add `whitespace-nowrap` and a `min-w` floor so the
content can drive the width. Both fixes are cheap; pick whichever
keeps the UI visually consistent with neighbours.

## Per-shape `cxnLst` indices need a per-shape remap, not a global one

The PPTX importer (`shape.ts`) uses `OOXML_TO_WAFFLE_RECT_SITE_INDEX
= [0, 3, 2, 1]` to remap the 4-site `[T, L, B, R]` cxnLst ordering
to Waffle's `[N, E, S, W]`. That map is correct for rect-family and
any 4-sided shape that follows the OOXML `[T, L, B, R]` convention
(diamond, parallelogram, trapezoid). Triangles (3-site cxnLst) and
some asymmetric shapes have shape-specific orderings, so the global
remap scrambles their indices.

**Why:** I added a triangle connection-site override and almost
shipped it before realising the importer would feed the wrong
`siteIndex` for triangle-attached PPTX connectors.

**How to apply:** When adding overrides for shapes whose OOXML
cxnLst length ≠ 4 OR whose ordering deviates from `[T, L, B, R]`,
either (a) add a per-shape `cxnLst → waffle` index table at import
time, or (b) hold the override back until that table exists. Don't
silently rely on the rect-family map for non-rect shapes.

The first review pass missed that n-gons (pentagon/hexagon/etc.)
ALSO hit the rect remap for idx 0..3 — only idx ≥ 4 bypasses it.
"5+ sided shapes skip the remap" was the wrong mental model.

## `SlidesStore` is implemented twice — extending the interface needs both

Adding a method to `SlidesStore` requires updating BOTH `MemSlidesStore`
(package-local, tested in `packages/slides`) AND
`YorkieSlidesStore` (`packages/frontend/src/app/slides/`). The latter
is the production store; `MemSlidesStore` is only used in tests.

**Why:** `verify:fast` runs slides tests against `MemSlidesStore` and
frontend `vitest`, but does NOT run frontend `tsc`. So a slides
interface extension can land green with the production store missing
the method — the user clicks the new action in production and gets
`TypeError: store.updateConnectorRouting is not a function`. Caught
in code review here; would have been an unhandled exception at the
right-click handler in production.

**How to apply:** Every change to `packages/slides/src/store/store.ts`
needs a paired diff hunk in
`packages/frontend/src/app/slides/yorkie-slides-store.ts`. Until
`verify:fast` runs frontend `tsc`, do it manually as part of the
change checklist — and consider extracting a shared
`SlidesStoreInterface.test.ts` (passes both impls through the same
contract) so an interface drift fails a test, not just `tsc`.

## `verify:fast` doesn't run frontend `tsc` — a lane gap

The frontend package has no `typecheck` script and `verify:fast`
doesn't invoke `tsc -p tsconfig.app.json` on it. The build (`vite
build`) does its own emit-time check, but `verify:fast` skips builds
to stay fast. Net effect: type-system regressions on the frontend
side land green.

**Why:** there are pre-existing type errors in `formatting-toolbar`,
`font-size-picker`, `text-format-group`, `user-presence`, and a few
proxy-typed Yorkie paths in `yorkie-slides-store.ts`. Adding a strict
typecheck script and wiring it into `verify:fast` would block on
those first. The right move is a follow-up: clean up the pre-existing
errors, add the typecheck script, then wire into the gate.

**How to apply:** until the lane gap closes, any extension to a
shared interface (`SlidesStore`, `DocsStore`, `Store`) needs the
implementer to manually run
`pnpm --filter @wafflebase/frontend exec tsc -p tsconfig.app.json
--noEmit` and confirm the implementing class still satisfies the
interface.
