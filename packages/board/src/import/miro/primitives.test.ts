import { describe, it, expect } from 'vitest';
import { miroFrame } from './geometry';
import { miroShapeKind } from './shape-kind';
import { stickyHex } from './colors';
import { miroHtmlToBlocks } from './text';

describe('miroFrame', () => {
  it('converts a center position + degrees into a top-left frame in radians', () => {
    const f = miroFrame({ x: 100, y: 200 }, { width: 40, height: 20, rotation: 90 });
    expect(f).toMatchObject({ x: 80, y: 190, w: 40, h: 20 });
    expect(f.rotation).toBeCloseTo(Math.PI / 2);
  });

  it('defaults missing size and rotation', () => {
    const f = miroFrame({ x: 0, y: 0 }, undefined, { w: 100, h: 50 });
    expect(f).toMatchObject({ x: -50, y: -25, w: 100, h: 50, rotation: 0 });
  });

  it('treats a missing position as the board origin', () => {
    const f = miroFrame(undefined, { width: 10, height: 10 });
    expect(f).toMatchObject({ x: -5, y: -5 });
  });
});

describe('miroShapeKind', () => {
  it('maps known Miro shape names to slides ShapeKinds', () => {
    expect(miroShapeKind('rectangle')).toEqual({ kind: 'rect', known: true });
    expect(miroShapeKind('round_rectangle')).toEqual({ kind: 'roundRect', known: true });
    expect(miroShapeKind('circle')).toEqual({ kind: 'ellipse', known: true });
    expect(miroShapeKind('rhombus')).toEqual({ kind: 'diamond', known: true });
    expect(miroShapeKind('star')).toEqual({ kind: 'star5', known: true });
    expect(miroShapeKind('cross')).toEqual({ kind: 'plus', known: true });
    expect(miroShapeKind('flow_chart_predefined_process'))
      .toEqual({ kind: 'flowChartPredefinedProcess', known: true });
  });

  it('falls back to rect and flags unknown names', () => {
    expect(miroShapeKind('sombrero')).toEqual({ kind: 'rect', known: false });
    expect(miroShapeKind(undefined)).toEqual({ kind: 'rect', known: false });
  });

  it('does not resolve inherited Object.prototype keys from untrusted names', () => {
    expect(miroShapeKind('constructor')).toEqual({ kind: 'rect', known: false });
    expect(miroShapeKind('__proto__')).toEqual({ kind: 'rect', known: false });
  });
});

describe('stickyHex', () => {
  it('maps Miro named sticky colors to hex', () => {
    expect(stickyHex('yellow')).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(stickyHex('light_green')).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(stickyHex('yellow')).not.toBe(stickyHex('light_green'));
  });

  it('falls back to the default sticky yellow for unknown or missing names', () => {
    expect(stickyHex('chartreuse')).toBe(stickyHex(undefined));
  });

  it('does not resolve inherited Object.prototype keys from untrusted names', () => {
    expect(stickyHex('constructor')).toBe(stickyHex(undefined));
    expect(stickyHex('constructor')).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

describe('miroHtmlToBlocks', () => {
  it('returns one paragraph block with the plain text', () => {
    const blocks = miroHtmlToBlocks('<p>Hello</p>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].inlines.map((i) => i.text).join('')).toBe('Hello');
  });

  it('splits multiple paragraphs into multiple blocks', () => {
    const blocks = miroHtmlToBlocks('<p>One</p><p>Two</p>');
    expect(blocks).toHaveLength(2);
    expect(blocks[1].inlines.map((i) => i.text).join('')).toBe('Two');
  });

  it('carries bold and italic onto the inline style', () => {
    const blocks = miroHtmlToBlocks('<p>a<strong>b</strong><em>c</em></p>');
    const inlines = blocks[0].inlines;
    expect(inlines.find((i) => i.text === 'b')?.style.bold).toBe(true);
    expect(inlines.find((i) => i.text === 'c')?.style.italic).toBe(true);
  });

  it('degrades an unknown tag to its text content', () => {
    const blocks = miroHtmlToBlocks('<p>x<marquee>y</marquee></p>');
    expect(blocks[0].inlines.map((i) => i.text).join('')).toBe('xy');
  });

  it('returns a single empty paragraph for empty or missing content', () => {
    expect(miroHtmlToBlocks(undefined)).toHaveLength(1);
    expect(miroHtmlToBlocks('')).toHaveLength(1);
  });
});
