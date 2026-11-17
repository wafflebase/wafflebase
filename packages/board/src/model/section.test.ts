import { describe, it, expect } from 'vitest';
import type { Element, Frame } from '@wafflebase/slides';
import {
  buildSectionInit,
  companionMoveIds,
  filterSectionLasso,
  frameAround,
  isMostlyInside,
  isSectionElement,
  listSections,
  sectionColorOf,
  sectionInsertIndex,
  sectionMemberIds,
  sectionOf,
  sectionsAt,
  SECTION_COLORS,
  unselectableIds,
} from './section';

const f = (x: number, y: number, w: number, h: number, rotation = 0): Frame => ({
  x, y, w, h, rotation,
});

function shape(id: string, frame: Frame): Element {
  return {
    id,
    type: 'shape',
    frame,
    data: { kind: 'rect', fill: { kind: 'srgb', value: '#FFF8B8' } },
  } as Element;
}

function section(
  id: string,
  frame: Frame,
  meta: { title?: string; hidden?: boolean; locked?: boolean } = {},
): Element {
  const init = buildSectionInit(frame, { title: meta.title ?? id });
  const data = (init as unknown as { data: { section: Record<string, unknown> } }).data;
  data.section = { ...data.section, ...meta, title: meta.title ?? id };
  return { ...init, id } as Element;
}

describe('sectionOf', () => {
  it('reads the marker off a section and nothing else', () => {
    const s = section('s', f(0, 0, 100, 100), { title: 'Ideas' });
    expect(sectionOf(s)).toEqual({ title: 'Ideas' });
    expect(isSectionElement(s)).toBe(true);
    expect(sectionOf(shape('a', f(0, 0, 1, 1)))).toBeUndefined();
    expect(sectionOf(undefined)).toBeUndefined();
  });

  it('rejects a marker without a string title', () => {
    const el = { ...shape('a', f(0, 0, 1, 1)) } as Element;
    (el as unknown as { data: Record<string, unknown> }).data.section = { title: 3 };
    expect(isSectionElement(el)).toBe(false);
  });
});

describe('buildSectionInit', () => {
  it('builds a tinted, bordered rect at the frame with the default colour', () => {
    const init = buildSectionInit({ x: 10, y: 20, w: 300, h: 200 }, { title: 'Q1' });
    expect(init.type).toBe('shape');
    expect(init.frame).toEqual(f(10, 20, 300, 200));
    const data = (init as unknown as { data: Record<string, unknown> }).data;
    expect(data.kind).toBe('rect');
    expect(data.section).toEqual({ title: 'Q1' });
    expect(data.fill).toEqual({ kind: 'srgb', value: SECTION_COLORS[0].fill });
  });

  it('reads its colour back from the fill', () => {
    const init = buildSectionInit(f(0, 0, 1, 1), { color: SECTION_COLORS[3] });
    expect(sectionColorOf({ ...init, id: 'x' } as Element).name).toBe(SECTION_COLORS[3].name);
  });
});

describe('isMostlyInside', () => {
  it('needs at least half the area inside', () => {
    const outer = f(0, 0, 100, 100);
    expect(isMostlyInside(f(10, 10, 20, 20), outer)).toBe(true);
    expect(isMostlyInside(f(90, 10, 20, 20), outer)).toBe(true); // exactly half
    expect(isMostlyInside(f(95, 10, 20, 20), outer)).toBe(false);
    expect(isMostlyInside(f(200, 200, 20, 20), outer)).toBe(false);
  });

  it('uses the centre of a degenerate box', () => {
    const outer = f(0, 0, 100, 100);
    expect(isMostlyInside(f(10, 50, 60, 0), outer)).toBe(true);
    expect(isMostlyInside(f(80, 50, 60, 0), outer)).toBe(false);
  });
});

describe('sectionMemberIds', () => {
  it('collects what lies mostly inside, nested sections and their contents', () => {
    const outer = section('outer', f(0, 0, 1000, 1000));
    const inner = section('inner', f(100, 100, 300, 300));
    const a = shape('a', f(150, 150, 50, 50)); // inside inner (and outer)
    const b = shape('b', f(600, 600, 50, 50)); // inside outer only
    const c = shape('c', f(2000, 0, 50, 50)); // outside
    const els = [outer, inner, a, b, c];
    expect(sectionMemberIds(els, outer).sort()).toEqual(['a', 'b', 'inner']);
    expect(sectionMemberIds(els, inner)).toEqual(['a']);
  });

  it('never makes a larger section a member of a smaller one', () => {
    const small = section('small', f(0, 0, 100, 100));
    const big = section('big', f(0, 0, 150, 150));
    expect(sectionMemberIds([small, big], small)).toEqual([]);
    expect(sectionMemberIds([small, big], big)).toEqual(['small']);
  });
});

describe('companionMoveIds', () => {
  it('carries the members of every moved section, minus what already moves', () => {
    const s = section('s', f(0, 0, 500, 500));
    const a = shape('a', f(10, 10, 50, 50));
    const b = shape('b', f(100, 100, 50, 50));
    const out = shape('out', f(900, 900, 50, 50));
    const els = [s, a, b, out];
    expect(companionMoveIds(['s'], els).sort()).toEqual(['a', 'b']);
    expect(companionMoveIds(['s', 'a'], els)).toEqual(['b']);
  });

  it('carries nothing for a moved ordinary element', () => {
    const s = section('s', f(0, 0, 500, 500));
    const a = shape('a', f(10, 10, 50, 50));
    expect(companionMoveIds(['a'], [s, a])).toEqual([]);
  });
});

describe('unselectableIds', () => {
  it('takes a locked section with its contents', () => {
    const s = section('s', f(0, 0, 500, 500), { locked: true });
    const a = shape('a', f(10, 10, 50, 50));
    const b = shape('b', f(900, 900, 50, 50));
    expect([...unselectableIds([s, a, b])].sort()).toEqual(['a', 's']);
  });

  it('takes the contents of a hidden section but leaves it selectable', () => {
    const s = section('s', f(0, 0, 500, 500), { hidden: true });
    const a = shape('a', f(10, 10, 50, 50));
    expect([...unselectableIds([s, a])]).toEqual(['a']);
  });

  it('is empty when nothing is hidden or locked', () => {
    const s = section('s', f(0, 0, 500, 500));
    expect(unselectableIds([s, shape('a', f(10, 10, 5, 5))]).size).toBe(0);
  });
});

describe('filterSectionLasso', () => {
  it('keeps a section only when the marquee encloses it whole', () => {
    const s = section('s', f(0, 0, 500, 500));
    const a = shape('a', f(10, 10, 50, 50));
    const els = [s, a];
    expect(filterSectionLasso(['s', 'a'], els, { x: 0, y: 0, w: 100, h: 100 })).toEqual(['a']);
    expect(filterSectionLasso(['s', 'a'], els, { x: -1, y: -1, w: 600, h: 600 })).toEqual(['s', 'a']);
  });
});

describe('sectionInsertIndex', () => {
  it('goes behind ordinary elements and smaller sections', () => {
    const big = section('big', f(0, 0, 1000, 1000));
    const small = section('small', f(0, 0, 100, 100));
    const a = shape('a', f(0, 0, 10, 10));
    const els = [big, small, a];
    expect(sectionInsertIndex(els, { w: 2000, h: 2000 })).toBe(0);
    expect(sectionInsertIndex(els, { w: 500, h: 500 })).toBe(1);
    expect(sectionInsertIndex(els, { w: 50, h: 50 })).toBe(2);
    expect(sectionInsertIndex([a], { w: 50, h: 50 })).toBe(0);
  });
});

describe('frameAround', () => {
  it('pads the union of the frames', () => {
    expect(frameAround([f(0, 0, 10, 10), f(100, 50, 10, 10)], 5)).toEqual(
      f(-5, -5, 120, 70),
    );
    expect(frameAround([])).toBeUndefined();
  });
});

describe('listSections / sectionsAt', () => {
  it('lists sections in reading order', () => {
    const a = section('a', f(500, 0, 10, 10));
    const b = section('b', f(0, 0, 10, 10));
    const c = section('c', f(0, 300, 10, 10));
    expect(listSections([c, a, shape('x', f(0, 0, 1, 1)), b]).map((s) => s.id)).toEqual([
      'b', 'a', 'c',
    ]);
  });

  it('finds the sections under a point, smallest first', () => {
    const outer = section('outer', f(0, 0, 1000, 1000));
    const inner = section('inner', f(100, 100, 300, 300));
    expect(sectionsAt([outer, inner], { x: 150, y: 150 }).map((s) => s.id)).toEqual([
      'inner', 'outer',
    ]);
    expect(sectionsAt([outer, inner], { x: 900, y: 900 }).map((s) => s.id)).toEqual(['outer']);
  });
});
