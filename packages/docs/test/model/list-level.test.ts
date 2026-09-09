import { describe, test, expect } from 'vitest';
import {
  planListLevelChanges,
  normalizeListLevel,
  MAX_LIST_LEVEL,
} from '../../src/model/list-level.js';
import { treeNodeToBlock } from '../../src/model/crdt-tree.js';
import { computeListCounters } from '../../src/view/layout.js';
import { computeTableLayout } from '../../src/view/table-layout.js';
import { serializeMarkdown } from '../../src/serialize/markdown.js';
import { createTableBlock, normalizeBlockStyle } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';
import { stubMeasurer } from '../view/_stub-measurer.js';

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

  // `listLevel` is read off a peer's Tree attribute through a bare
  // `Number(...)`, so a non-finite or out-of-band value can reach the
  // planner. Every comparison against `NaN` is false, which would make the
  // floor and the ceiling fail open.
  describe('a poisoned listLevel', () => {
    test('NaN does not swallow the following run as children', () => {
      const blocks = [item('a', NaN), item('b', 0), item('c', 0)];
      // `a` reads as level 0, so `b` at the same level is a sibling — not a
      // child dragged along by the gesture.
      expect(plan(blocks, ['a'], 1)).toEqual({ a: 1 });
    });

    test('NaN is repaired rather than written back', () => {
      const blocks = [item('a', NaN)];
      expect(plan(blocks, ['a'], 1)).toEqual({ a: 1 });
      // And it holds the floor: level 0 refuses to outdent.
      expect(plan(blocks, ['a'], -1)).toEqual({});
    });

    test('a level past the ceiling still refuses to indent', () => {
      const blocks = [item('a', MAX_LIST_LEVEL + 40)];
      expect(plan(blocks, ['a'], 1)).toEqual({});
      // Outdent normalizes it down to the ceiling first.
      expect(plan(blocks, ['a'], -1)).toEqual({ a: MAX_LIST_LEVEL - 1 });
    });

    test('a negative level holds the floor', () => {
      const blocks = [item('a', -5)];
      expect(plan(blocks, ['a'], -1)).toEqual({});
      expect(plan(blocks, ['a'], 1)).toEqual({ a: 1 });
    });

    test('an Infinite level cannot be written back or dragged along', () => {
      const blocks = [item('a', 0), item('b', Infinity)];
      // Non-finite reads as 0, so `b` is a sibling of `a` rather than an
      // unbounded child, and the gesture writes only finite levels.
      expect(plan(blocks, ['a'], 1)).toEqual({ a: 1 });
      expect(plan(blocks, ['a', 'b'], 1)).toEqual({ a: 1, b: 1 });
    });
  });
});

describe('normalizeListLevel', () => {
  test('passes an in-band level through', () => {
    expect(normalizeListLevel(0)).toBe(0);
    expect(normalizeListLevel(3)).toBe(3);
    expect(normalizeListLevel(MAX_LIST_LEVEL)).toBe(MAX_LIST_LEVEL);
  });

  test('an absent level is level 0', () => {
    expect(normalizeListLevel(undefined)).toBe(0);
  });

  test('a non-finite level is level 0', () => {
    expect(normalizeListLevel(NaN)).toBe(0);
    expect(normalizeListLevel(Infinity)).toBe(0);
    expect(normalizeListLevel(-Infinity)).toBe(0);
  });

  test('a level outside the band is clamped to it', () => {
    expect(normalizeListLevel(-5)).toBe(0);
    expect(normalizeListLevel(1e9)).toBe(MAX_LIST_LEVEL);
  });

  test('a fractional level floors', () => {
    expect(normalizeListLevel(2.7)).toBe(2);
  });
});

/**
 * The planner is not the only reader. `listLevel` arrives off a peer's Tree
 * attribute through a bare `Number(...)`, and every other consumer — the
 * layout pass, the markdown serializer, the PDF painter — multiplies it into
 * geometry or repeats a string with it. Those readers run on first render
 * and on export, before any gesture, so normalizing only inside the planner
 * leaves a poisoned level reaching them raw: `levelCounters.length = NaN` is
 * a `RangeError` that takes the whole layout down, and `'  '.repeat(2e9)`
 * either allocates gigabytes or throws.
 */
describe('a poisoned listLevel at the raw readers', () => {
  test('the CRDT read boundary clamps a peer-supplied level', () => {
    const read = (listLevel: string): number | undefined =>
      treeNodeToBlock({
        type: 'block',
        attributes: { type: 'list-item', listKind: 'unordered', listLevel },
        children: [],
      }).listLevel;

    expect(read('2')).toBe(2);
    expect(read('1e9')).toBe(MAX_LIST_LEVEL);
    expect(read('Infinity')).toBe(0);
    expect(read('not-a-number')).toBe(0);
    expect(read('-4')).toBe(0);
  });

  test('computeListCounters does not throw on a non-finite level', () => {
    const poisoned = (id: string, listLevel: number): Block => ({
      ...item(id, listLevel),
      listKind: 'ordered',
    });
    expect(() =>
      computeListCounters([poisoned('a', NaN), poisoned('b', 1e9)]),
    ).not.toThrow();
    // Both read as in-band levels, so both still get a marker.
    const counters = computeListCounters([
      poisoned('a', NaN),
      poisoned('b', 1e9),
    ]);
    expect(counters.get('a')).toBeDefined();
    expect(counters.get('b')).toBeDefined();
  });

  // The body indent and the cell indent are the same expression in two
  // files, so clamping only the body one leaves a poisoned level producing a
  // NaN `marginLeft` — and a blank block — inside a table cell.
  test('a table cell lays a poisoned list item out at finite geometry', () => {
    const block = createTableBlock(1, 1);
    const cell = block.tableData!.rows[0].cells[0];
    cell.blocks = [item('a', NaN)];
    const layout = computeTableLayout(
      block.tableData!,
      'poisoned-table',
      stubMeasurer(7),
      300,
    );
    expect(Number.isFinite(layout.rowHeights[0])).toBe(true);
    const lines = layout.cells[0][0].lines;
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(Number.isFinite(line.width)).toBe(true);
      for (const run of line.runs) expect(Number.isFinite(run.x)).toBe(true);
    }
  });

  test('the markdown serializer bounds the indent it repeats', () => {
    const md = serializeMarkdown({
      blocks: [item('a', 1e9), item('b', NaN)],
    });
    // At most `MAX_LIST_LEVEL` levels of two-space indent, never 2e9.
    for (const line of md.split('\n')) {
      const indent = line.length - line.trimStart().length;
      expect(indent).toBeLessThanOrEqual(MAX_LIST_LEVEL * 2);
    }
  });
});
