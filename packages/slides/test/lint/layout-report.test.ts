import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BLOCK_STYLE,
  type Block,
  type ResolvedFont,
  type TextMeasurer,
} from '@wafflebase/docs';
import { layoutReport } from '../../src/lint/layout-report';
import { estimateMeasurer } from '../../src/lint/estimate-measurer';
import type { AutofitMode, Element } from '../../src/model/element';
import type { SlidesDocument } from '../../src/model/presentation';
import { defaultLight } from '../../src/themes/default-light';

// Deterministic: every character is 0.5 em.
const measurer: TextMeasurer = {
  measureWidth: (text: string, font: ResolvedFont) => text.length * font.size * 0.5,
};

const frame = (x: number, y: number, w: number, h: number) => ({ x, y, w, h, rotation: 0 });

function para(text: string, fontSize = 24): Block {
  return {
    id: `b-${text.slice(0, 8)}`,
    type: 'paragraph',
    inlines: [{ text, style: { fontSize } }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}

function text(id: string, f: ReturnType<typeof frame>, blocks: Block[], autofit?: AutofitMode): Element {
  return { id, type: 'text', frame: f, data: { blocks, ...(autofit ? { autofit } : {}) } } as Element;
}

function deck(elements: Element[]): SlidesDocument {
  return {
    meta: { title: 't', themeId: defaultLight.id, masterId: 'm' },
    themes: [defaultLight],
    masters: [],
    layouts: [],
    guides: [],
    slides: [{ id: 's1', layoutId: 'l', background: {}, elements, notes: [] }],
  };
}

describe('layoutReport', () => {
  it('reports line count, heights and on-slide fraction per element', () => {
    const long = Array.from({ length: 10 }, () => 'word').join(' ');
    const [slide] = layoutReport(
      deck([text('t', frame(1820, 100, 200, 40), [para(long)], 'none')]),
      { measurer },
    );
    const [el] = slide.elements;
    expect(el).toMatchObject({ elementId: 't', type: 'text', visibleFraction: 0.5 });
    expect(el.text).toMatchObject({ autofit: 'none', overflows: true, boxHeight: 40 });
    expect(el.text!.lines).toBeGreaterThan(1);
  });
});

describe('estimateMeasurer', () => {
  const font: ResolvedFont = { family: 'Arial', size: 100, weight: 'normal', style: 'normal' };
  it('gives wide characters about an em and Latin about half', () => {
    const m = estimateMeasurer();
    expect(m.measureWidth('가', font)).toBe(95);
    expect(m.measureWidth('a', font)).toBe(50);
    expect(m.measureWidth('a', { ...font, weight: 'bold' })).toBeCloseTo(52.5);
  });
});

describe('layoutReport text placement', () => {
  it('reports a grow body by the height it paints at', () => {
    const long = Array.from({ length: 20 }, () => 'word').join(' ');
    const [slide] = layoutReport(deck([text('t', frame(100, 100, 200, 40), [para(long)])]), {
      measurer,
    });
    const t = slide.elements[0].text!;
    expect(t.autofit).toBe('grow');
    expect(t.paintedHeight).toBeGreaterThan(40);
  });
});
