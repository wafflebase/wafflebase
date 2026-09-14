/**
 * How deep one table may be nested inside another before a reader stops
 * descending.
 *
 * Table nesting is the one shape in this model that is *structurally*
 * recursive — `block > row > cell > block > …` — so unlike a poisoned number
 * it cannot be banded by clamping a value. Every reader of a docs CRDT tree
 * walks it by recursion (`treeNodeToBlock` in `crdt-tree.ts` and its live twin
 * in the frontend's `YorkieDocStore`), and the layout that follows recurses
 * again (`computeTableLayout` ⇄ `layoutCellBlocks`, `view/table-layout.ts`).
 * A peer can write that chain to any depth it likes with plain Tree node
 * writes — no UI is involved and no attribute is out of band — so a few tens
 * of thousands of levels overflow the stack of *every* reader on first read or
 * first paint, for a document nobody can then open to repair. It is the same
 * "one peer's write hangs everyone's tab" hazard the numeric bands
 * (`numeric-attrs.ts`) and the `blockParentMap` cycle guards close, arriving
 * through structure instead of a value.
 *
 * The ceiling is far above any real document: Word itself stops authors at
 * about 20 levels, and this editor's own "insert table in cell" is a
 * one-level-at-a-time gesture. A table below the cap is read as a table with
 * no rows rather than dropped, so the document still opens and everything
 * around the truncation renders — the same "degrade, do not vanish" direction
 * the numeric bands take.
 */
export const MAX_TABLE_NESTING_DEPTH = 32;
