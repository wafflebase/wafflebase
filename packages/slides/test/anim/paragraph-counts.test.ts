import { describe, it, expect } from 'vitest';
import { DEFAULT_BLOCK_STYLE, type Block } from '@wafflebase/docs';
import type {
  GroupElement,
  ImageElement,
  ShapeElement,
  TextElement,
} from '../../src/model/element';
import type { Slide } from '../../src/model/presentation';
import { buildParagraphCounts } from '../../src/anim/paragraph-counts';

const baseFrame = { x: 0, y: 0, w: 100, h: 100, rotation: 0 };

function makeBlock(text = 'hello'): Block {
  return {
    id: 'b1',
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}

function makeSlide(elements: Slide['elements']): Slide {
  return {
    id: 's1',
    layoutId: 'l1',
    background: { fill: { kind: 'role', role: 'background' } },
    elements,
    notes: [],
    animations: [],
  };
}

describe('buildParagraphCounts', () => {
  it('counts blocks in a TextElement', () => {
    const el: TextElement = {
      id: 'text1',
      type: 'text',
      frame: baseFrame,
      data: { blocks: [makeBlock(), makeBlock(), makeBlock()] },
    };
    const counts = buildParagraphCounts(makeSlide([el]));
    expect(counts.get('text1')).toBe(3);
  });

  it('counts blocks in a ShapeElement with data.text', () => {
    const el: ShapeElement = {
      id: 'shape1',
      type: 'shape',
      frame: baseFrame,
      data: {
        kind: 'rect',
        text: { blocks: [makeBlock(), makeBlock()] },
      },
    };
    const counts = buildParagraphCounts(makeSlide([el]));
    expect(counts.get('shape1')).toBe(2);
  });

  it('does not include non-text elements (image)', () => {
    const el: ImageElement = {
      id: 'img1',
      type: 'image',
      frame: baseFrame,
      data: { src: 'x.png' },
    };
    const counts = buildParagraphCounts(makeSlide([el]));
    expect(counts.has('img1')).toBe(false);
  });

  it('does not include ShapeElement without data.text', () => {
    const el: ShapeElement = {
      id: 'shape2',
      type: 'shape',
      frame: baseFrame,
      data: { kind: 'ellipse' },
    };
    const counts = buildParagraphCounts(makeSlide([el]));
    expect(counts.has('shape2')).toBe(false);
  });

  it('uses max(1, count) guard so empty TextElement yields 1', () => {
    const el: TextElement = {
      id: 'empty1',
      type: 'text',
      frame: baseFrame,
      data: { blocks: [] },
    };
    const counts = buildParagraphCounts(makeSlide([el]));
    expect(counts.get('empty1')).toBe(1);
  });

  it('flattens group children and counts nested TextElement blocks', () => {
    const innerText: TextElement = {
      id: 'inner-text',
      type: 'text',
      frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
      data: { blocks: [makeBlock(), makeBlock()] },
    };
    const group: GroupElement = {
      id: 'grp1',
      type: 'group',
      frame: baseFrame,
      data: { children: [innerText] },
    };
    const counts = buildParagraphCounts(makeSlide([group]));
    expect(counts.get('inner-text')).toBe(2);
  });
});
