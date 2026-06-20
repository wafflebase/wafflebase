---
title: docs-list-item-backspace-exit
target-version: 0.4.4
---

<!-- Small single-file fix; note kept lightweight (issue #338). -->

# Docs List-Item Backspace Exit

## Summary

Pressing Backspace at the start of an **empty list item** should exit the list —
convert the item back to a normal paragraph — matching what Enter already does
and matching Google Docs / Notion. Today Backspace does not do this (issue #338):

- If the empty list item is the **first block** (e.g. an empty document with
  numbering applied), Backspace is a **no-op** — the list/numbering can't be
  removed at all.
- If it is **not the first block**, Backspace merges it into the previous block
  instead of cleanly exiting the list.

## Background

### Enter already handles this; Backspace does not

The two paths live in `packages/docs/src/model/document.ts`:

- **Enter → `splitBlock()`** has an early branch that exits the list:
  ```ts
  // splitBlock(blockId, offset)
  if (block.type === 'list-item' && blockText.length === 0) {
    this.setBlockType(blockId, 'paragraph');   // exit list, no new block
    return blockId;
  }
  ```
- **Backspace → `deleteBackward()`** has **no** equivalent branch. At
  `offset === 0` it goes straight to "merge with previous block":
  ```ts
  // deleteBackward(pos)
  const blockIndex = this.getBlockIndex(pos.blockId);
  if (blockIndex <= 0) return pos;          // first block → no-op  ← empty-doc bug
  ...
  this.mergeBlocks(prevBlock.id, currentBlock.id);
  ```

So the user-visible asymmetry (Enter exits the list, Backspace doesn't) maps
directly to a missing branch in `deleteBackward`. The empty-document case is a
no-op specifically because `if (blockIndex <= 0) return pos` returns before any
list handling.

## Goals

- Backspace at `offset 0` of an **empty `list-item`** converts it to a
  `paragraph` (exits the list), regardless of whether it is the first block.
- Behavior parity with Enter (`splitBlock`) and with Google Docs / Notion.
- No change to: deleting a character mid-block, merging non-empty blocks, or any
  non-`list-item` block.

## Non-Goals

- **Nested-list outdent semantics.** Google Docs, on an empty *indented* list
  item (`listLevel > 0`), outdents one level per Backspace and only exits to a
  paragraph at level 0. This note matches Enter's simpler behavior (straight to
  paragraph) — per-level outdent is a possible follow-up (see Open Questions).
- Distinguishing numbered vs bulleted lists — both are `list-item` and handled
  identically.

## Proposal Details

Add the same empty-list-item branch to `deleteBackward()` that `splitBlock()`
already has, placed **after** the `offset > 0` early return and **before** the
`if (blockIndex <= 0) return pos` guard so it fires for the first-block case too:

```ts
deleteBackward(pos: DocPosition): DocPosition {
  if (pos.offset > 0) {
    const newPos = { blockId: pos.blockId, offset: pos.offset - 1 };
    this.deleteText(newPos, 1);
    return newPos;
  }

  // Empty list-item: exit the list by converting to a paragraph (mirror splitBlock).
  // Placed before the blockIndex<=0 guard so it also fires when the list item is
  // the first/only block (the empty-document case in #338).
  const curBlock = this.getBlock(pos.blockId);
  if (curBlock.type === 'list-item' && getBlockTextLength(curBlock) === 0) {
    this.setBlockType(pos.blockId, 'paragraph');
    return pos;
  }

  // At start of block — merge with previous (unchanged)
  ...
}
```

Notes:

- Use a distinct local name (e.g. `curBlock`) — `deleteBackward` already declares
  `const currentBlock = blocks[blockIndex]` further down, so reusing that name
  would shadow/conflict.
- `getBlockTextLength` is already imported and used in this function.
- Returning `pos` unchanged keeps the caret where it is; only the block *type*
  changes, so the caret stays at offset 0 of the now-paragraph.

### Risks and Mitigation

- **Variable shadowing** with the existing `currentBlock` declaration → use a
  separate name; covered by the TypeScript build.
- **Nested lists** (`listLevel > 0`) exit straight to paragraph rather than
  outdenting — intentional for parity with Enter; flagged as a follow-up, not a
  regression (today nothing works at all).
- **Context scope** — `deleteBackward` operates on `getContextBlocks()`
  (body/header/footer); table-cell Backspace is handled separately in the view
  layer and does not reach here, so cell list items are out of scope for this fix.

## Test Plan

Unit tests in `packages/docs/test/model/document.test.ts`, mirroring the existing
"convert empty list-item to paragraph (exit list)" test that already covers
`splitBlock`:

- Backspace on an empty `list-item` that is the **first/only block** → becomes a
  `paragraph` (the #338 repro).
- Backspace on an empty `list-item` that is **not** the first block → becomes a
  `paragraph` (not merged into the previous block).
- Backspace on a **non-empty** `list-item` at offset 0 → unchanged behavior
  (merges with previous, as before).
- Backspace on a non-empty list item mid-text → unchanged (deletes a character).

## Open Questions

1. **Nested lists** — should Backspace on an empty `listLevel > 0` item outdent
   one level (Google Docs) instead of jumping straight to a paragraph? Proposed:
   match Enter (straight to paragraph) now; track per-level outdent as a separate
   issue if desired. (Enter's `splitBlock` would want the same treatment for
   consistency.)

## References

- Issue: https://github.com/wafflebase/wafflebase/issues/338
- Mirrors `Doc.splitBlock()` empty-list-item handling in
  `packages/docs/src/model/document.ts`.
