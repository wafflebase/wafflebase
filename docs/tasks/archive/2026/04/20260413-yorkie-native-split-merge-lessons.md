# Yorkie v0.7.4 Native Split/Merge — Lessons

## Key Takeaways

1. **splitLevel=2 needed for Wafflebase**: Our tree structure is `doc > para > text`, so splitting a paragraph requires `splitLevel=2` (not 1 as initially assumed from ProseMirror's flatter structure).

2. **Post-split styleByPath is essential**: Native split copies the original block's attributes verbatim. The "after" block needs its `id`, `type`, `headingLevel`, `listKind`, `listLevel` adjusted via `styleByPath` immediately after the split.

3. **Merge boundary = block close tag to next block's first content position**: The merge operation deletes from the end of one block through the start of the next, letting Yorkie's CRDT handle text concatenation.

4. **Adjacency guard prevents crashes**: mergeBlock must verify the next block actually exists and is adjacent before attempting boundary deletion.

5. **Two-client integration tests caught real convergence issues**: Unit tests alone wouldn't have surfaced the concurrent split/merge edge cases that the integration tests revealed.
