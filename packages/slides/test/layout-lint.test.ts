import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BLOCK_STYLE,
  type Block,
  type ResolvedFont,
  type TextMeasurer,
} from '@wafflebase/docs';
import { lintLayout } from '../src/layout-lint';
import type { AutofitMode, Element } from '../src/model/element';
import type { Slide } from '../src/model/presentation';

const measurer: TextMeasurer = {
  measureWidth: (text: string, font: ResolvedFont) => text.length * font.size * 0.6,
};

function para(text: string, fontSize = 20): Block {
  return {
    id: `b-${text.slice(0, 6)}`,
    type: 'paragraph',
    inlines: [{ text, style: { fontSize } }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}

const frame = (x: number, y: number, w: number, h: number) => ({
  x, y, w, h, rotation: 0,
});

function textEl(
  id: string,
  f: ReturnType<typeof frame>,
  text: string,
  autofit?: AutofitMode,
): Element {
  return {
    id,
    type: 'text',
    frame: f,
    data: { blocks: [para(text)], ...(autofit ? { autofit } : {}) },
  };
}

function rect(id: string, f: ReturnType<typeof frame>): Element {
  return {
    id,
    type: 'shape',
    frame: f,
    data: { kind: 'rect' },
  } as Element;
}

function deck(...elementsPerSlide: Element[][]) {
  const slides = elementsPerSlide.map(
    (elements, i): Slide => ({
      id: `s${i}`,
      layoutId: 'l',
      background: {},
      elements,
      notes: [],
    }),
  );
  return { slides };
}

describe('lintLayout', () => {
  it('reports nothing for a clean deck', () => {
    const d = deck([
      textEl('title', frame(100, 100, 800, 120), 'Hello', 'none'),
      textEl('body', frame(100, 300, 800, 300), 'World', 'none'),
    ]);
    expect(lintLayout(d, { measurer })).toEqual([]);
  });

  it('flags overlapping foreground boxes', () => {
    const d = deck([
      textEl('a', frame(100, 100, 400, 200), 'A', 'none'),
      textEl('b', frame(300, 200, 400, 200), 'B', 'none'),
    ]);
    const f = lintLayout(d, { measurer });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ slideIndex: 0, elementId: 'b', kind: 'overlap' });
  });

  it('ignores overlaps within tolerance', () => {
    const d = deck([
      textEl('a', frame(100, 100, 400, 200), 'A', 'none'),
      textEl('b', frame(100, 302, 400, 200), 'B', 'none'),
    ]);
    expect(lintLayout(d, { measurer })).toEqual([]);
  });

  it('does not flag content over a full-bleed background or decorative spine', () => {
    const d = deck([
      rect('bg', frame(0, 0, 1920, 1080)),
      rect('spine', frame(60, 100, 8, 800)),
      textEl('t', frame(40, 100, 800, 120), 'Title', 'none'),
      textEl('b', frame(100, 300, 800, 300), 'Body', 'none'),
    ]);
    expect(lintLayout(d, { measurer })).toEqual([]);
  });

  it('flags content over background when exclusion is disabled', () => {
    const d = deck([
      rect('bg', frame(0, 0, 1920, 1080)),
      textEl('t', frame(100, 100, 800, 120), 'Title', 'none'),
    ]);
    const f = lintLayout(d, {
      measurer,
      excludeBackground: false,
      ignoreContainers: false,
    });
    expect(f.map((x) => x.kind)).toEqual(['overlap']);
  });

  it("flags autofit 'none' text taller than its frame", () => {
    const long = 'word '.repeat(200);
    const d = deck([textEl('t', frame(100, 100, 400, 60), long, 'none')]);
    const f = lintLayout(d, { measurer });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ elementId: 't', kind: 'overflow' });
  });

  it("does not flag a 'shrink' box that fits after scaling", () => {
    const text = 'word '.repeat(40);
    const d = deck([textEl('t', frame(100, 100, 400, 200), text, 'shrink')]);
    expect(lintLayout(d, { measurer })).toEqual([]);
  });

  it("flags a 'shrink' box that cannot fit even at min scale", () => {
    const long = 'word '.repeat(5000);
    const d = deck([textEl('t', frame(100, 100, 200, 20), long, 'shrink')]);
    const f = lintLayout(d, { measurer });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ elementId: 't', kind: 'overflow' });
  });

  it("flags a 'grow' box whose grown height leaves the slide", () => {
    const long = 'word '.repeat(300);
    const d = deck([textEl('t', frame(100, 900, 400, 50), long)]);
    const f = lintLayout(d, { measurer });
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe('overflow');
  });

  it('can run a single rule', () => {
    const d = deck([
      textEl('a', frame(100, 100, 400, 200), 'A', 'none'),
      textEl('b', frame(300, 200, 400, 200), 'B', 'none'),
    ]);
    expect(lintLayout(d, { measurer, rules: ['overflow'] })).toEqual([]);
  });
});
