import type { Block } from './types.js';

/**
 * Deepest list level a `list-item` may reach (0-based), matching the
 * clamp the clipboard parser applies to a pasted `listLevel`.
 */
export const MAX_LIST_LEVEL = 8;

/** One block's new `listLevel`, resolved before anything is written. */
export interface ListLevelChange {
  block: Block;
  listLevel: number;
}

/**
 * The children of a list item are the following contiguous run of
 * `list-item` blocks whose `listLevel` is strictly greater than its own,
 * stopping at the first block that is not a list item or is at the
 * same-or-shallower level. The model carries no parent pointer
 * (`listLevel` is a flat integer, like OOXML's `w:ilvl`), so hierarchy is
 * implied by adjacency and has to be re-derived here.
 *
 * Returns the last index of `blocks[index]`'s subtree (the item itself
 * when it has no children) together with the subtree's deepest level.
 */
function subtreeOf(
  blocks: ReadonlyArray<Block>,
  index: number,
): { end: number; deepest: number } {
  const level = blocks[index].listLevel ?? 0;
  let end = index;
  let deepest = level;
  for (let i = index + 1; i < blocks.length; i++) {
    const next = blocks[i];
    if (next.type !== 'list-item') break;
    const nextLevel = next.listLevel ?? 0;
    if (nextLevel <= level) break;
    end = i;
    deepest = Math.max(deepest, nextLevel);
  }
  return { end, deepest };
}

/**
 * Plan a ±1 list-level change over the selected items of one sibling
 * array. Each selected item moves together with its nested children, so
 * the relative depth of the subtree is preserved — a parent stays a
 * parent (issue #1050).
 *
 * Boundaries apply to the subtree as a unit: outdent is refused when the
 * root is already at level 0, indent when the subtree's *deepest* member
 * is already at `MAX_LIST_LEVEL`. Clamping a single member instead would
 * collapse the depth gap, which is the bug this exists to prevent. A
 * selected block already covered by an earlier item's subtree — refused
 * or not — is skipped, so every child moves exactly once.
 */
function planSiblingGroup(
  blocks: ReadonlyArray<Block>,
  selectedIds: ReadonlySet<string>,
  delta: 1 | -1,
): Array<ListLevelChange> {
  const changes: Array<ListLevelChange> = [];
  const covered = new Set<string>();
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.type !== 'list-item') continue;
    if (!selectedIds.has(block.id) || covered.has(block.id)) continue;

    const { end, deepest } = subtreeOf(blocks, i);
    for (let j = i; j <= end; j++) covered.add(blocks[j].id);

    const level = block.listLevel ?? 0;
    if (delta < 0 && level <= 0) continue;
    if (delta > 0 && deepest >= MAX_LIST_LEVEL) continue;

    for (let j = i; j <= end; j++) {
      changes.push({
        block: blocks[j],
        listLevel: (blocks[j].listLevel ?? 0) + delta,
      });
    }
  }
  return changes;
}

/**
 * Plan a ±1 list-level change for every `list-item` the current
 * selection covers, including the nested children of each one.
 *
 * `forEachBlock` is the caller's own selection walker; it hands each
 * covered block together with the sibling array that contains it, so
 * blocks in different table cells are planned as separate list contexts.
 * The whole plan is computed from the pre-edit levels and returned
 * unapplied — writing while walking would let a subtree's second item
 * see its parent's new level and mis-detect its own parent.
 */
export function planListLevelChanges(
  forEachBlock: (
    fn: (block: Block, siblings: ReadonlyArray<Block>) => void,
  ) => void,
  delta: 1 | -1,
): Array<ListLevelChange> {
  const groups = new Map<ReadonlyArray<Block>, Set<string>>();
  forEachBlock((block, siblings) => {
    if (block.type !== 'list-item') return;
    let ids = groups.get(siblings);
    if (!ids) {
      ids = new Set();
      groups.set(siblings, ids);
    }
    ids.add(block.id);
  });

  const changes: Array<ListLevelChange> = [];
  for (const [siblings, ids] of groups) {
    changes.push(...planSiblingGroup(siblings, ids, delta));
  }
  return changes;
}
