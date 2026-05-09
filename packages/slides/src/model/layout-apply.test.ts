import { describe, it, expect } from 'vitest';
import { DEFAULT_BLOCK_STYLE, type Block } from '@wafflebase/docs';
import { applyLayoutToSlide, getLayout } from './layout';
import { DEFAULT_MASTER } from './master';
import type { Element, TextElement } from './element';
import type { Slide } from './presentation';
import { defaultLight } from '../themes/default-light';

function blocks(text: string): Block[] {
  return [
    {
      id: 'b1',
      type: 'paragraph',
      inlines: [{ text, style: {} }],
      style: { ...DEFAULT_BLOCK_STYLE },
    },
  ];
}

function textEl(
  id: string,
  body: string,
  frame: { x: number; y: number; w: number; h: number },
  placeholderRef?: { type: 'title' | 'subtitle' | 'body' | 'caption' | 'big-number'; index: number },
): TextElement {
  return {
    id,
    type: 'text',
    frame: { ...frame, rotation: 0 },
    placeholderRef,
    data: { blocks: blocks(body) },
  };
}

function makeSlide(layoutId: string, elements: Element[]): Slide {
  return {
    id: 's1',
    layoutId,
    background: { fill: { kind: 'role', role: 'background' } },
    elements,
    notes: [],
  };
}

describe('applyLayoutToSlide', () => {
  it('1. blank slide → new layout produces fresh placeholders only', () => {
    const slide = makeSlide('blank', []);
    applyLayoutToSlide(slide, getLayout('title-body'));
    expect(slide.layoutId).toBe('title-body');
    expect(slide.elements.map((e) => e.placeholderRef?.type)).toEqual([
      'title',
      'body',
    ]);
  });

  it('2. typed placeholder → preserved into same-type slot', () => {
    const oldLayout = getLayout('title-body');
    const slide = makeSlide('title-body', [
      textEl('e-title', 'Hello',  oldLayout.placeholders[0].frame, { type: 'title', index: 0 }),
      textEl('e-body',  'World!', oldLayout.placeholders[1].frame, { type: 'body',  index: 0 }),
    ]);
    applyLayoutToSlide(slide, getLayout('title-only'));
    expect(slide.elements).toHaveLength(2); // title kept; body demoted
    const title = slide.elements.find((e) => e.placeholderRef?.type === 'title');
    expect((title as TextElement).data.blocks[0].inlines[0].text).toBe('Hello');
    const demoted = slide.elements.find((e) => e.placeholderRef === undefined);
    expect(demoted).toBeDefined();
    expect((demoted as TextElement).data.blocks[0].inlines[0].text).toBe('World!');
  });

  it('3. ambiguous same-type body slots match by index', () => {
    const fromLayout = getLayout('title-two-columns');
    const slide = makeSlide('title-two-columns', [
      textEl('e0', 'T',     fromLayout.placeholders[0].frame, { type: 'title', index: 0 }),
      textEl('e1', 'left',  fromLayout.placeholders[1].frame, { type: 'body',  index: 0 }),
      textEl('e2', 'right', fromLayout.placeholders[2].frame, { type: 'body',  index: 1 }),
    ]);
    applyLayoutToSlide(slide, getLayout('title-two-columns')); // identity reslot
    const bodies = slide.elements
      .filter((e) => e.placeholderRef?.type === 'body')
      .sort((a, b) => (a.placeholderRef!.index - b.placeholderRef!.index));
    expect((bodies[0] as TextElement).data.blocks[0].inlines[0].text).toBe('left');
    expect((bodies[1] as TextElement).data.blocks[0].inlines[0].text).toBe('right');
  });

  it('4. fewer slots, empty orphan → deleted', () => {
    const fromLayout = getLayout('title-body');
    const slide = makeSlide('title-body', [
      textEl('e0', '', fromLayout.placeholders[0].frame, { type: 'title', index: 0 }),
      textEl('e1', '', fromLayout.placeholders[1].frame, { type: 'body',  index: 0 }),
    ]);
    applyLayoutToSlide(slide, getLayout('title-only'));
    expect(slide.elements).toHaveLength(1);
    expect(slide.elements[0].placeholderRef?.type).toBe('title');
  });

  it('5. fewer slots, non-empty orphan → demoted (frame and content preserved)', () => {
    const fromLayout = getLayout('title-body');
    const originalBodyFrame = fromLayout.placeholders[1].frame;
    const slide = makeSlide('title-body', [
      textEl('e0', 'T',    fromLayout.placeholders[0].frame, { type: 'title', index: 0 }),
      textEl('e1', 'kept', originalBodyFrame,                { type: 'body',  index: 0 }),
    ]);
    applyLayoutToSlide(slide, getLayout('title-only'));
    const demoted = slide.elements.find(
      (e) => e.id === 'e1',
    ) as TextElement | undefined;
    expect(demoted).toBeDefined();
    expect(demoted!.placeholderRef).toBeUndefined();
    expect(demoted!.frame).toMatchObject(originalBodyFrame);
    expect(demoted!.data.blocks[0].inlines[0].text).toBe('kept');
  });

  it('fresh placeholder materialized via context gets master-seeded blocks', () => {
    const slide = makeSlide('blank', []);
    const master = DEFAULT_MASTER;
    const theme = defaultLight;
    applyLayoutToSlide(slide, getLayout('title-body'), { master, theme });
    const titleEl = slide.elements.find((e) => e.placeholderRef?.type === 'title');
    if (titleEl && titleEl.type === 'text') {
      expect(titleEl.data.blocks[0]?.inlines[0]?.style.fontSize).toBe(44);
    } else {
      expect.fail('title element missing or not text');
    }
  });

  it('6. user-added elements are untouched', () => {
    const fromLayout = getLayout('title-body');
    const userText = textEl('user', 'mine', { x: 50, y: 50, w: 100, h: 30 }); // no ref
    const slide = makeSlide('title-body', [
      textEl('e0', 'T', fromLayout.placeholders[0].frame, { type: 'title', index: 0 }),
      userText,
    ]);
    applyLayoutToSlide(slide, getLayout('title-only'));
    const stillUser = slide.elements.find((e) => e.id === 'user') as TextElement;
    expect(stillUser).toBeDefined();
    expect(stillUser.placeholderRef).toBeUndefined();
    expect(stillUser.frame).toMatchObject({ x: 50, y: 50, w: 100, h: 30 });
    expect(stillUser.data.blocks[0].inlines[0].text).toBe('mine');
  });
});
