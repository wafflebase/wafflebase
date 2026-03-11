# Range Styles Compaction — Per-Key Shadow Pruning

## Goal

Reduce Yorkie document size and improve rendering performance by
compacting the `rangeStyles` patch array more aggressively. The current
`pruneShadowedRangeStylePatches` only removes patches when the entire
style object matches. This task extends it to prune individual style
keys that are fully covered by later patches.

## Design

### Algorithm: Per-Key Shadow Pruning

Extend `pruneShadowedRangeStylePatches` in `range-styles.ts`:

1. Traverse patches in reverse order (newest to oldest).
2. For each patch, check later (already-processed) patches that fully
   contain its range (`containsRange`).
3. For each style key in the current patch, check if any containing
   later patch sets the same key — if so, the key is shadowed and can
   be removed from the current patch.
4. If all keys are removed, delete the entire patch.

**Scope**: Only handles full containment relationships. Partial overlap
is out of scope — the real-world pattern of repeated styling on the
same selection makes full containment the dominant case.

**Complexity**: O(n² × k) where n = patch count, k = style key count
(max 15, fixed). Effectively O(n²), same as current implementation.

### Integration

- Modify `pruneShadowedRangeStylePatches()` in
  `packages/sheet/src/model/range-styles.ts`.
- No changes to call sites: `compactShadowedRangeStyles()` in
  `sheet.ts` already calls this function after every
  `addRangeStylePatch()`.
- Trigger timing: every style application (as requested).

### Example

```
Before:
  [0] { A1:C3, { b: true, bg: "#ff0" } }
  [1] { A1:C3, { b: false, i: true } }
  [2] { A1:C3, { b: true, bg: "#0ff" } }

After:
  [0] { A1:C3, { i: true } }        ← b removed (covered by [2]), bg removed (covered by [2])
                                       patch [1] absorbed into [0] after b removed
  [1] { A1:C3, { b: true, bg: "#0ff" } }
```

### What does NOT change

- Cell-level styles (`.s` field) are not touched.
- Column/row/sheet styles are not touched.
- Patch ordering semantics are preserved.
- `resolveRangeStyleAt()` resolution logic is unchanged.

## Test Plan

- [x] Same range, different styles: earlier patch key removed when
      later patch covers it
- [x] Full containment, partial key overlap: only overlapping keys
      pruned, others kept
- [x] Multi-layer stacking: 3+ patches with progressive key coverage
- [x] Empty patch removal: patch with all keys pruned is deleted
- [x] Regression: identical style + full containment still works
- [x] Existing tests in formatting.test.ts continue to pass

## Status

- [x] Implement per-key pruning in `pruneShadowedRangeStylePatches`
- [x] Add unit tests (packages/sheet/test/model/range-styles.test.ts)
- [x] Run `pnpm verify:fast` — all 554 sheet + 20 frontend + 17 backend tests pass
