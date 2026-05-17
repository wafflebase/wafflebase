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
