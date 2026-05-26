# PPTX connector site index — lessons

## OOXML site index ordering ≠ Waffle's FOUR_CARDINAL

PPTX preset shapes `rect` and `roundRect` define `cxnLst` in order
`T, L, B, R` (idx 0..3). Waffle's `FOUR_CARDINAL`
(`packages/slides/src/view/canvas/connection-sites/defaults.ts`) is in
order `N, E, S, W` — i.e. `T, R, B, L`. Indices 1 and 3 swap.

`parseCxnSp` was passing the raw OOXML `idx` straight through as
`siteIndex`, so every left/right anchor landed on the opposite edge of
the target shape. The frame (bounding box) was correct, which made the
bug visually subtle — only the resolved endpoint was wrong.

**Apply when:** wiring any indexed lookup that crosses the
OOXML/Waffle boundary. Don't assume the orderings match. Today the only
indexed lookup is `cxnLst`, but the same pitfall will hit per-shape
overrides (slides-connectors PR2) and any future preset geometry table.

## TextBoxEditorOptions `scale` field — stale docs `dist/` blocked typecheck

`packages/docs/dist/` is gitignored. After PR #256 added a `scale?`
field to `TextBoxEditorOptions`, anyone who pulled the change but
didn't run `pnpm --filter @wafflebase/docs build` was left with a
stale `dist/wafflebase-document.es.d.ts` missing the new field. The
slides package consumes the dist types directly, so its typecheck
fails until docs is rebuilt.

**Apply when:** `pnpm verify:fast` fails with `TS2353` on a property
that exists in the source, especially if it cites a package boundary
(slides → docs). Run the cross-package build before assuming the bug
is in your branch.

## Paint-transform and site-resolution must mirror each other

`element-renderer.ts:50-64` paints a flipped shape with
`translate(centre) → rotate → scale(flip) → translate(-w/2,-h/2)`,
so the path is visually mirrored around the frame centre. But
`siteWorldPos` was only applying rotation — it ignored
`frame.flipH`/`frame.flipV`. Result: attached connectors landed on
the *pre-mirror* edge while the shape painted as mirrored, so
connectors visually hit the wrong side. Discovered after the
import-time idx swap fix because slide 24 has no flipped shapes (so
the runtime gap was invisible), but slide 26's right-side MVC group
mirrors every shape via `flipH=1`.

**Apply when:** adding any geometry/transform path that has both a
paint side and a "where did this end up in world space" side.
Whatever the paint code does, the resolver must do too — and in the
same order. The two are coupled invariants; drifting them is how
clicks miss, snap markers float, and connectors mis-route.

OOXML semantics back this up: `cxnLst` entries are declared in
pre-flip local coords, and the runtime is expected to apply the
shape's flip transform when resolving them. PowerPoint/Google Slides
behave the same way — flipping a shape also moves attached
connectors to the visually-mirrored edge.

## Backward compatibility for already-imported decks

Decks that were imported *before* this fix have the buggy `siteIndex`
values persisted in Yorkie (1↔3 swapped at the storage layer). They
will continue to render at the wrong edge until re-imported — the fix
only changes the import path, not stored data. Acceptable here because
PPTX import is one-shot and re-importing is cheap; calling it out so
nobody is surprised when an old shared link still looks wrong.

## TDD for `parseCxnSp` — go through `parseSpTree`, not the private function

`parseCxnSp` is module-private. Testing through the exported
`parseSpTree` with a small synthetic `<p:spTree>` avoids opening up
internal API just for tests, and matches the pattern used elsewhere
(`table.test.ts`, `image.test.ts`).
