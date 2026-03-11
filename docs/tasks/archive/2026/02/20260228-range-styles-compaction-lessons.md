# Range Styles Compaction — Lessons

## Decisions

- Chose per-key shadow pruning over partial overlap merge (approach A)
  and snapshot rebuild (approach C). Per-key pruning naturally extends
  existing `pruneShadowedRangeStylePatches` and covers the dominant
  use case of repeated styling on the same range.
- Trigger at style-application time (not threshold or idle). The
  existing call path already invokes compaction after every
  `addRangeStylePatch`, so no new trigger mechanism is needed.
- Scope limited to `rangeStyles` array only — no baking into cell-level
  `.s` styles. This keeps the change small and safe.

## Observations

- One existing test ("should prune older range patch shadowed by later
  identical patch" in formatting.test.ts) needed its expected stored
  patches updated because the new per-key logic correctly prunes a
  `{b: false}` override that was previously kept. The resolved style
  assertions were unchanged — the behavior is identical, just fewer
  patches stored.
- The `stylesEqual` helper is no longer used by the pruning function
  but remains used by `coalesceAdjacentRangeStylePatches` — not dead
  code.
- Algorithmic complexity stays O(n²) since k (style key count) is
  bounded at 15. No performance concerns for typical workloads.
