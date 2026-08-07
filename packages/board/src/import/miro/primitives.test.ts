import { describe, it, expect } from 'vitest';
import { miroFrame, resolveMiroFrames } from './geometry';
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

describe('resolveMiroFrames', () => {
  // A frame at canvas (1000, 2000), 400x200 → top-left (800, 1900).
  const frame = {
    id: 'f1',
    position: { x: 1000, y: 2000 },
    geometry: { width: 400, height: 200 },
  };

  it('leaves a parentless item at its canvas position', () => {
    const { frames } = resolveMiroFrames([frame]);
    expect(frames.get('f1')).toMatchObject({ x: 800, y: 1900 });
  });

  it('offsets a child by its parent top-left', () => {
    // Miro gives a framed item's position against the PARENT'S TOP-LEFT, so
    // (50, 60) here means the item centre sits at canvas (850, 1960).
    const { frames, orphans } = resolveMiroFrames([
      frame,
      {
        id: 's1',
        position: { x: 50, y: 60, relativeTo: 'parent_top_left' },
        geometry: { width: 20, height: 10 },
        parent: { id: 'f1' },
      },
    ]);
    expect(frames.get('s1')).toMatchObject({ x: 840, y: 1955, w: 20, h: 10 });
    expect(orphans.size).toBe(0);
  });

  it('treats a parent with no explicit relativeTo as parent-relative', () => {
    // Older payloads omit `relativeTo`. Having a parent at all is what makes
    // the coordinate frame-local, so the offset must still apply.
    const { frames } = resolveMiroFrames([
      frame,
      {
        id: 's1',
        position: { x: 50, y: 60 },
        geometry: { width: 20, height: 10 },
        parent: { id: 'f1' },
      },
    ]);
    expect(frames.get('s1')).toMatchObject({ x: 840, y: 1955 });
  });

  it('keeps an explicit canvas_center position absolute despite a parent', () => {
    const { frames } = resolveMiroFrames([
      frame,
      {
        id: 's1',
        position: { x: 50, y: 60, relativeTo: 'canvas_center' },
        geometry: { width: 20, height: 10 },
        parent: { id: 'f1' },
      },
    ]);
    expect(frames.get('s1')).toMatchObject({ x: 40, y: 55 });
  });

  it('reports a child whose parent is absent from the payload as an orphan', () => {
    // The parent can fall outside the import's item ceiling. There is no
    // absolute coordinate to recover, so the raw position is kept and the item
    // is named rather than silently misplaced.
    const { frames, orphans } = resolveMiroFrames([
      {
        id: 's1',
        position: { x: 50, y: 60, relativeTo: 'parent_top_left' },
        geometry: { width: 20, height: 10 },
        parent: { id: 'gone' },
      },
    ]);
    expect(frames.get('s1')).toMatchObject({ x: 40, y: 55 });
    expect([...orphans]).toEqual(['s1']);
  });

  it('resolves a grandchild through the whole parent chain', () => {
    const { frames } = resolveMiroFrames([
      frame,
      {
        id: 'mid',
        position: { x: 10, y: 20 },
        geometry: { width: 100, height: 100 },
        parent: { id: 'f1' },
      },
      {
        id: 's1',
        position: { x: 5, y: 5 },
        geometry: { width: 20, height: 10 },
        parent: { id: 'mid' },
      },
    ]);
    // mid centre → (810, 1920); its top-left → (760, 1870).
    expect(frames.get('mid')).toMatchObject({ x: 760, y: 1870 });
    // s1 centre → (765, 1875); its top-left → (755, 1870).
    expect(frames.get('s1')).toMatchObject({ x: 755, y: 1870 });
  });

  it('does not hang on a parent cycle', () => {
    const { frames, orphans } = resolveMiroFrames([
      { id: 'a', position: { x: 0, y: 0 }, geometry: { width: 10, height: 10 }, parent: { id: 'b' } },
      { id: 'b', position: { x: 0, y: 0 }, geometry: { width: 10, height: 10 }, parent: { id: 'a' } },
    ]);
    expect(frames.size).toBe(2);
    expect(orphans.size).toBeGreaterThan(0);
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
