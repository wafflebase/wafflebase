import type { Block } from './types.js';

/**
 * Deepest list level a `list-item` may reach (0-based). It is also OOXML's
 * `ST_TextIndentLevelType` ceiling, which is what the editors' indent gesture
 * and the PPTX exporter are bounded by.
 */
export const MAX_LIST_LEVEL = 8;

/** One block's new `listLevel`, resolved before anything is written. */
export interface ListLevelChange {
  block: Block;
  listLevel: number;
}

/**
 * A `listLevel` as a number every reader can trust: a finite integer
 * inside `[0, MAX_LIST_LEVEL]`. A non-finite or absent level reads as 0.
 *
 * The field arrives unvalidated on the collaborative path — a peer's Tree
 * attribute is read straight through `Number(...)`, and the backend's
 * content ingest serializes whatever it is handed — so `NaN`, `Infinity`,
 * a negative, or a level far past the ceiling can all reach a reader.
 *
 * In the planner, every comparison against `NaN` is false, which made both
 * guards below fail *open*: `subtreeOf` would swallow the whole following
 * run of list items instead of stopping at the first same-or-shallower
 * one, and the indent ceiling would let the run climb past
 * `MAX_LIST_LEVEL` writing `NaN` levels as it went.
 *
 * The planner is not the only reader, and the others are worse off: they
 * multiply the level into geometry or repeat a string with it, and they
 * run on first render and on export — before any gesture could repair the
 * value. `computeListCounters` does `levelCounters.length = level + 1`
 * (`RangeError: Invalid array length` on `NaN`, a gigabyte allocation on
 * `1e9`) and the markdown serializer does `'  '.repeat(level)`
 * (`RangeError: Invalid string length`), so one hostile collaborator could
 * blank the rendered document, or the `--format md` export, for every
 * other reader. Both are exported here rather than clamped per call site
 * so the band has one definition; the raw readers call
 * `normalizeListLevel` at the point of use.
 */
export function normalizeListLevel(raw: number | undefined): number {
  const level = raw ?? 0;
  if (!Number.isFinite(level)) return 0;
  return Math.min(MAX_LIST_LEVEL, Math.max(0, Math.floor(level)));
}

/** {@link normalizeListLevel} of a block's own `listLevel`. */
function levelOf(block: Block): number {
  return normalizeListLevel(block.listLevel);
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
  const level = levelOf(blocks[index]);
  let end = index;
  let deepest = level;
  for (let i = index + 1; i < blocks.length; i++) {
    const next = blocks[i];
    if (next.type !== 'list-item') break;
    const nextLevel = levelOf(next);
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
 * selected block already *moved* as part of an earlier item's subtree is
 * skipped, so every child moves exactly once.
 *
 * A refused subtree suppresses only itself: its members are left
 * uncovered, so a deeper one the user also selected is re-examined as a
 * subtree root in its own right and moves if it has room. Suppressing them
 * too would make select-all + Shift+Tab a no-op on any document whose
 * first list item is a root — the child is only carried *along with* its
 * parent, and a child the user selected asked to move on its own account.
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
    const level = levelOf(block);
    // Refused: nothing is marked covered, so a selected descendant is
    // reconsidered as its own subtree root below.
    if (delta < 0 && level <= 0) continue;
    if (delta > 0 && deepest >= MAX_LIST_LEVEL) continue;

    for (let j = i; j <= end; j++) {
      covered.add(blocks[j].id);
      changes.push({
        block: blocks[j],
        // Normalized, so a poisoned level is repaired by the gesture that
        // touches it rather than propagated.
        listLevel: levelOf(blocks[j]) + delta,
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
