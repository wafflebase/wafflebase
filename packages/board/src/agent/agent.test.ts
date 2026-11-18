import { describe, expect, it } from 'vitest';
import type { Element, Frame } from '@wafflebase/slides';
import { buildStickyInit } from '../model/sticky';
import { buildSectionInit, SECTION_PADDING } from '../model/section';
import { summarizeBoard, plainText, elementKind } from './summary';
import { findFreeRect, gridOrigins, gridSize, besideContent, besideFrame } from './layout';
import { planMoves, planGridSection, lockedIds } from './moves';
import { buildTextBoxInit, estimateTextHeight } from './text';

const sticky = (id: string, x: number, y: number, text = id): Element =>
  ({ ...buildStickyInit('#FFF8B8', { x: x + 90, y: y + 90 }, { text }), id }) as Element;

const section = (id: string, f: Omit<Frame, 'rotation'>, locked = false): Element => {
  const el = { ...buildSectionInit(f, { title: id }), id } as Element;
  if (locked) (el as unknown as { data: { section: { locked?: boolean } } }).data.section.locked = true;
  return el;
};

const overlaps = (a: Frame, b: Frame) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('summarizeBoard', () => {
  it('reports kinds, plain text and the innermost section', () => {
    const outer = section('outer', { x: 0, y: 0, w: 1000, h: 1000 });
    const inner = section('inner', { x: 20, y: 20, w: 400, h: 400 });
    const a = sticky('a', 40, 40, 'hello');
    const b = sticky('b', 600, 600);
    const out = summarizeBoard([outer, inner, a, b]);
    expect(out.map((e) => [e.id, e.kind, e.section])).toEqual([
      ['outer', 'section', undefined],
      ['inner', 'section', 'outer'],
      ['a', 'sticky', 'inner'],
      ['b', 'sticky', 'outer'],
    ]);
    expect(out[2].text).toBe('hello');
  });

  it('reads text from text boxes and connector labels; none from an image', () => {
    const text = { ...buildTextBoxInit('one\ntwo', { x: 0, y: 0 }), id: 't' } as Element;
    expect(plainText(text)).toBe('one\ntwo');
    expect(elementKind(text)).toBe('text');

    const label = (buildTextBoxInit('yes', { x: 0, y: 0 }) as unknown as { data: { blocks: unknown[] } }).data;
    const connector = {
      id: 'c',
      type: 'connector',
      frame: { x: 0, y: 0, w: 100, h: 0, rotation: 0 },
      routing: 'straight',
      start: { kind: 'attached', elementId: 'a', siteIndex: 1 },
      end: { kind: 'free', x: 100, y: 0 },
      arrowheads: {},
      label: { blocks: label.blocks },
    } as unknown as Element;
    expect(plainText(connector)).toBe('yes');
    expect(elementKind(connector)).toBe('connector');
    expect(plainText({ ...connector, label: undefined } as Element)).toBeUndefined();

    const image = {
      id: 'i',
      type: 'image',
      frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
      data: { src: 'https://x.test/a.png', alt: 'not body text' },
    } as unknown as Element;
    expect(plainText(image)).toBeUndefined();
    expect(elementKind(image)).toBe('image');
  });

  it('summarizes a connector with its label and glued ends, and an image without text', () => {
    const a = sticky('a', 0, 0);
    const b = sticky('b', 600, 0);
    const label = (buildTextBoxInit('depends on', { x: 0, y: 0 }) as unknown as { data: { blocks: unknown[] } }).data;
    const glued = {
      id: 'c',
      type: 'connector',
      frame: { x: 180, y: 90, w: 420, h: 0, rotation: 0 },
      routing: 'elbow',
      start: { kind: 'attached', elementId: 'a', siteIndex: 1 },
      end: { kind: 'attached', elementId: 'b', siteIndex: 3 },
      arrowheads: { end: { kind: 'triangle', size: 'md' } },
      label: { blocks: label.blocks },
    } as unknown as Element;
    const loose = {
      ...glued,
      id: 'd',
      start: { kind: 'free', x: 0, y: 500 },
      end: { kind: 'attached', elementId: 'b', siteIndex: 0 },
      label: undefined,
    } as unknown as Element;
    const image = {
      id: 'i',
      type: 'image',
      frame: { x: 0, y: 900, w: 100, h: 100, rotation: 0 },
      data: { src: 'https://x.test/a.png' },
    } as unknown as Element;
    const out = summarizeBoard([a, b, glued, loose, image]);
    const byId = new Map(out.map((e) => [e.id, e]));
    expect(byId.get('c')).toMatchObject({ kind: 'connector', text: 'depends on', from: 'a', to: 'b' });
    const d = byId.get('d')!;
    expect(d).toMatchObject({ kind: 'connector', to: 'b' });
    expect('from' in d).toBe(false);
    expect('text' in d).toBe(false);
    const i = byId.get('i')!;
    expect(i.kind).toBe('image');
    expect('text' in i || 'from' in i || 'color' in i).toBe(false);
  });
});

describe('layout', () => {
  it('lays a grid out in reading order', () => {
    expect(gridSize(5, { w: 10, h: 10 }, 3, 2)).toEqual({ w: 34, h: 22 });
    expect(gridOrigins(4, { x: 0, y: 0 }, { w: 10, h: 10 }, 2, 2)).toEqual([
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 0, y: 12 },
      { x: 12, y: 12 },
    ]);
  });

  it('finds a spot that covers nothing', () => {
    const occupied: Frame[] = [{ x: 0, y: 0, w: 100, h: 100, rotation: 0 }];
    const p = findFreeRect(occupied, { w: 50, h: 50 }, { x: 10, y: 10 });
    expect(overlaps({ ...p, w: 50, h: 50, rotation: 0 }, occupied[0])).toBe(false);
    expect(findFreeRect([], { w: 50, h: 50 }, { x: 10, y: 10 })).toEqual({ x: 10, y: 10 });
  });

  it('aims beside the content or beside a frame', () => {
    const f: Frame = { x: 0, y: 0, w: 100, h: 50, rotation: 0 };
    expect(besideContent([f]).x).toBeGreaterThan(100);
    expect(besideContent([])).toEqual({ x: 0, y: 0 });
    expect(besideFrame(f, { w: 10, h: 10 }, 'below')).toEqual({ x: 0, y: 98 });
    expect(besideFrame(f, { w: 10, h: 10 }, 'left')).toEqual({ x: -58, y: 0 });
  });
});

describe('planMoves', () => {
  it('carries the members of a moved section, not of a resized one', () => {
    const s = section('s', { x: 0, y: 0, w: 400, h: 400 });
    const a = sticky('a', 40, 40);
    const moved = planMoves([s, a], [{ id: 's', x: 10, y: 20 }]);
    expect(moved.ok && moved.carried).toEqual(['a']);
    const resized = planMoves([s, a], [{ id: 's', x: 0, y: 0, w: 800, h: 800 }]);
    expect(resized.ok && resized.carried).toEqual([]);
  });

  it('does not carry a member the batch moves itself', () => {
    const s = section('s', { x: 0, y: 0, w: 400, h: 400 });
    const a = sticky('a', 40, 40);
    const plan = planMoves([s, a], [{ id: 's', x: 10, y: 0 }, { id: 'a', x: 900, y: 0 }]);
    expect(plan.ok && plan.carried).toEqual([]);
    expect(plan.ok && plan.changed.find((e) => e.id === 'a')?.frame.x).toBe(900);
  });

  it('refuses unknown, duplicate and locked targets', () => {
    const s = section('s', { x: 0, y: 0, w: 400, h: 400 }, true);
    const a = sticky('a', 40, 40);
    expect(lockedIds([s, a])).toEqual(new Set(['s', 'a']));
    expect(planMoves([s, a], [{ id: 'zz', x: 0, y: 0 }])).toMatchObject({ ok: false, reason: 'not_found' });
    expect(planMoves([s, a], [{ id: 'a', x: 0, y: 0 }])).toMatchObject({ ok: false, reason: 'locked' });
    const b = sticky('b', 900, 0);
    expect(
      planMoves([b], [{ id: 'b', x: 0, y: 0 }, { id: 'b', x: 1, y: 1 }]),
    ).toMatchObject({ ok: false, reason: 'duplicate' });
  });
});

describe('planGridSection', () => {
  it('grids the members inside a padded frame clear of other content', () => {
    const others = sticky('x', 0, 0);
    const items = [sticky('a', 5000, 0), sticky('b', -3000, 0), sticky('c', 0, 4000)];
    const { moves, frame } = planGridSection([others, ...items], ['a', 'b', 'c']);
    expect(frame.w).toBe(180 * 2 + 24 + SECTION_PADDING * 2);
    expect(overlaps(frame, others.frame)).toBe(false);
    expect(moves.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(moves[0]).toMatchObject({ x: frame.x + SECTION_PADDING, y: frame.y + SECTION_PADDING });
  });
});

describe('buildTextBoxInit', () => {
  it('is a grow text box with one paragraph per line, tall enough for its text', () => {
    const init = buildTextBoxInit('a\nb\nc', { x: 1, y: 2 }, { bold: true });
    const data = (init as unknown as { data: unknown }).data as { autofit: string; blocks: { inlines: { text: string; style: { bold?: boolean } }[] }[] };
    expect(data.autofit).toBe('grow');
    expect(data.blocks.map((b) => b.inlines[0].text)).toEqual(['a', 'b', 'c']);
    expect(data.blocks[0].inlines[0].style.bold).toBe(true);
    expect(estimateTextHeight('x'.repeat(500))).toBeGreaterThan(estimateTextHeight('x'));
  });
});

describe('plainText on an untrusted group tree', () => {
  it('stops at the shared group depth cap instead of overflowing the stack', () => {
    let el = {
      id: 'leaf',
      type: 'text',
      frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
      data: { blocks: [{ id: 'b', type: 'paragraph', inlines: [{ text: 'hi', style: {} }], style: {} }] },
    } as unknown as Element;
    for (let i = 0; i < 200_000; i++) {
      el = {
        id: `g${i}`,
        type: 'group',
        frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
        data: { children: [el] },
      } as unknown as Element;
    }
    expect(() => plainText(el)).not.toThrow();
    expect(plainText(el)).toBeUndefined();
  });
});
