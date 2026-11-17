import { describe, it, expect } from 'vitest';
import { buildInsertElement } from '../../../../src/view/editor/interactions/insert';
import { SLIDES_DEFAULT_TEXT_SIZE } from '../../../../src/view/editor/default-text';

describe('buildInsertElement text default', () => {
  it('seeds a user-inserted text box with grow autofit', () => {
    const el = buildInsertElement('text', { x: 0, y: 0 }, { x: 100, y: 40 });
    expect(el.type).toBe('text');
    if (el.type === 'text') expect(el.data.autofit).toBe('grow');
  });

  it('seeds the text box at the slides default font size (18pt), not docs 11pt', () => {
    const el = buildInsertElement('text', { x: 0, y: 0 }, { x: 100, y: 40 });
    if (el.type !== 'text') throw new Error('expected a text element');
    const inline = el.data.blocks[0]?.inlines[0];
    expect(inline?.style.fontSize).toBe(SLIDES_DEFAULT_TEXT_SIZE);
    expect(SLIDES_DEFAULT_TEXT_SIZE).toBe(18);
  });
});

describe('buildInsertElement shape style hook', () => {
  it('keeps the theme-accent default when no hook is passed', () => {
    const el = buildInsertElement('rect', { x: 0, y: 0 }, { x: 0, y: 0 });
    if (el.type !== 'shape') throw new Error('expected a shape');
    expect(el.data.fill).toEqual({ kind: 'role', role: 'accent1' });
  });

  it('hands the hook the kind and the default style, and uses its answer', () => {
    const calls: unknown[] = [];
    const el = buildInsertElement('ellipse', { x: 0, y: 0 }, { x: 50, y: 50 }, (kind, defaults) => {
      calls.push([kind, defaults]);
      return { fill: { kind: 'srgb', value: '#eef' } };
    });
    if (el.type !== 'shape') throw new Error('expected a shape');
    expect(calls).toEqual([
      ['ellipse', { fill: { kind: 'role', role: 'accent1' }, stroke: { color: { kind: 'role', role: 'text' }, width: 1 } }],
    ]);
    expect(el.data.fill).toEqual({ kind: 'srgb', value: '#eef' });
    expect(el.data.stroke).toBeUndefined();
    expect(el.data.kind).toBe('ellipse');
  });

  it('never runs the hook for a text box', () => {
    let called = false;
    buildInsertElement('text', { x: 0, y: 0 }, { x: 0, y: 0 }, (_k, d) => {
      called = true;
      return d;
    });
    expect(called).toBe(false);
  });
});
