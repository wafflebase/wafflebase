# Lessons — grouped element edit entry

**Date:** 2026-06-03

## Pattern to watch for

Whenever editor code looks up an element by id, ask: "is this
likely to be called for an element nested inside a group?" If yes,
**never use `Array.prototype.find` on `slide.elements`** — it's
non-recursive and will silently return `undefined` for grouped
elements, which the surrounding code then treats as "no such
element" and bails. The store side uses `findElementPath`
recursively; the view side should match.

Bugs found together in this PR:

| Symptom | File | Line |
|---|---|---|
| Grouped text-box won't enter edit on double-click | `editor.ts` | 2172 (was) |
| Grouped shape's adjustment diamond drag does nothing | `editor.ts` | 3288 (was) |
| Editing element keeps painting under the in-place editor | `editor.ts` | 893–907 (was) |
| Adjustment live preview misses grouped shape | `editor.ts` | 3360 (was) |

All four were one pattern: `slide.elements.find/map` assuming top-
level. Use the recursive helpers (`findElement`, `findElementPath`,
`buildElementWorldLookup`) or write a small recursive walker.

## World vs local frame

For overlay DOM mounts (text-box editor, adjustment handles) and
for math that compares against pointer coords, the frame must be in
world coords. The stored frame is **group-local**. Compose the
ancestor transforms with `buildElementWorldLookup` (canonical) or
`scopeAncestorTransform` + `applyGroupTransform`.

Store-side writes go through `updateElementFrame` /
`updateElementData` which still take element-local frames — so on
write-back, don't blindly hand world coords to the store.
`enterEditMode` keeps `enterFrameH = localElement.frame.h` for the
post-commit autofit comparison even though the mount path uses the
world-frame element.

## jsdom can't drive overlay handle hit-test

`Editor.handleAtClient` reads `overlay.getBoundingClientRect()` and
the overlay's child handle positions. jsdom returns zero for both,
so a unit test that "drags the adjustment diamond" doesn't reach
`startAdjustmentDrag`. Two viable strategies:

1. Test the helper (`replaceShapeAdjustments`, world-frame
   resolution) in isolation rather than the full pointer path.
2. Manual smoke against `pnpm dev` for the actual drag.

Don't waste cycles trying to fake layout in jsdom — `puppeteer`
against the dev server confirms the drag end-to-end (and lets you
read the store state to verify the write).

## "Same root cause" really means the same diff

When the user reported the slide 31 Dogfooding case mid-PR, the
temptation was to file a follow-up. But the root cause was
literally the same pattern on adjacent functions in the same file.
Folding both into one PR kept the recursive-walk + world-frame
discipline consistent across all four call sites — splitting
would have meant two reviews of the same idea against the same
file and a higher chance of one side drifting.
