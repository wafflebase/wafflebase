import { describe, test, expect } from 'vitest';
import { planListLevelChanges, MAX_LIST_LEVEL } from '../../src/model/list-level.js';
import { normalizeBlockStyle } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';

/**
 * Changing a list item's level carries its nested children, so the
 * relative depth of the subtree survives the gesture (issue #1050).
 */

function item(id: string, listLevel = 0): Block {
  return {
    id,
    type: 'list-item',
    listKind: 'unordered',
    listLevel,
    inlines: [{ text: id, style: {} }],
    style: normalizeBlockStyle({}),
  };
}

function paragraph(id: string): Block {
  return {
    id,
    type: 'paragraph',
    inlines: [{ text: id, style: {} }],
    style: normalizeBlockStyle({}),
  };
}

/** Plan over one sibling array with `selected` ids covered by the walk. */
function plan(
  blocks: Block[],
  selected: string[],
  delta: 1 | -1,
): Record<string, number> {
  const ids = new Set(selected);
  const changes = planListLevelChanges((fn) => {
    for (const b of blocks) {
      if (ids.has(b.id)) fn(b, blocks);
    }
  }, delta);
  const out: Record<string, number> = {};
  for (const c of changes) out[c.block.id] = c.listLevel;
  return out;
}

describe('planListLevelChanges', () => {
  test('indenting a parent carries its nested children', () => {
    const blocks = [item('a', 0), item('b', 1), item('c', 0)];
    expect(plan(blocks, ['a'], 1)).toEqual({ a: 1, b: 2 });
  });

  test('outdenting a parent pulls its nested children up', () => {
    const blocks = [item('a', 1), item('b', 2), item('c', 1)];
    expect(plan(blocks, ['a'], -1)).toEqual({ a: 0, b: 1 });
  });

  test('the subtree is the whole deeper run, not just one child', () => {
    const blocks = [item('a', 0), item('b', 1), item('c', 3), item('d', 1), item('e', 0)];
    expect(plan(blocks, ['a'], 1)).toEqual({ a: 1, b: 2, c: 4, d: 2 });
  });

  test('a non-list block ends the subtree', () => {
    const blocks = [item('a', 0), item('b', 1), paragraph('p'), item('c', 1)];
    expect(plan(blocks, ['a'], 1)).toEqual({ a: 1, b: 2 });
  });

  test('equal-level neighbours are siblings, not children', () => {
    const blocks = [item('a', 1), item('b', 1)];
    expect(plan(blocks, ['a'], 1)).toEqual({ a: 2 });
  });

  test('a selected child moves exactly once', () => {
    const blocks = [item('a', 0), item('b', 1), item('c', 2)];
    expect(plan(blocks, ['a', 'b', 'c'], 1)).toEqual({ a: 1, b: 2, c: 3 });
  });

  test('floor: a level-0 root refuses, and its children stay put', () => {
    const blocks = [item('a', 0), item('b', 1)];
    expect(plan(blocks, ['a'], -1)).toEqual({});
    // Even when the child is selected too — moving it alone would flatten
    // it into a sibling of its own parent.
    expect(plan(blocks, ['a', 'b'], -1)).toEqual({});
  });

  test('outdenting a child on its own is unaffected by its parent', () => {
    const blocks = [item('a', 0), item('b', 1)];
    expect(plan(blocks, ['b'], -1)).toEqual({ b: 0 });
  });

  test('ceiling: a subtree whose deepest member is maxed refuses as a unit', () => {
    const blocks = [item('a', MAX_LIST_LEVEL - 1), item('b', MAX_LIST_LEVEL)];
    expect(plan(blocks, ['a'], 1)).toEqual({});
    // The maxed item alone is refused as well.
    expect(plan(blocks, ['b'], 1)).toEqual({});
  });

  test('ceiling only refuses the subtree that hit it', () => {
    const blocks = [item('a', 0), item('b', MAX_LIST_LEVEL), item('c', 0)];
    expect(plan(blocks, ['a', 'c'], 1)).toEqual({ c: 1 });
  });

  test('blocks in separate sibling arrays are planned independently', () => {
    const cellOne = [item('a', 0), item('b', 1)];
    const cellTwo = [item('c', 0)];
    const changes = planListLevelChanges((fn) => {
      fn(cellOne[0], cellOne);
      fn(cellTwo[0], cellTwo);
    }, 1);
    expect(changes.map((c) => [c.block.id, c.listLevel])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 1],
    ]);
  });

  test('non-list blocks in the selection are never planned', () => {
    const blocks = [paragraph('p'), item('a', 0)];
    expect(plan(blocks, ['p', 'a'], 1)).toEqual({ a: 1 });
  });
});
