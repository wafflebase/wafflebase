import { describe, it, expect } from 'vitest';
import { slideToXml, notesSlideToXml } from '../../../src/export/pptx/slide.js';
import type { Slide } from '../../../src/model/presentation.js';
import type { ElementXmlCtx } from '../../../src/export/pptx/group.js';
import type { Block } from '@wafflebase/docs';

const ctx: ElementXmlCtx = {
  resolveImageRId: () => 'rId1',
  connectorFrame: () => ({ x: 0, y: 0, w: 1, h: 1, rotation: 0 }),
};

describe('slideToXml', () => {
  it('starts with XML declaration', () => {
    const slide: Slide = {
      id: 's1',
      layoutId: 'blank',
      background: { fill: { kind: 'role', role: 'background' } },
      elements: [],
      notes: [],
    } as unknown as Slide;
    const xml = slideToXml(slide, ctx);
    expect(xml).toMatch(/^<\?xml /);
  });

  it('emits sld with spTree and a shape', () => {
    const slide: Slide = {
      id: 's1',
      layoutId: 'blank',
      background: { fill: { kind: 'role', role: 'background' } },
      elements: [
        {
          id: 'sh',
          frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
          type: 'shape',
          data: { kind: 'rect' },
        },
      ],
      notes: [],
    } as unknown as Slide;
    const xml = slideToXml(slide, ctx);
    expect(xml).toContain('<p:sld');
    expect(xml).toContain('<p:spTree>');
    expect(xml).toContain('<p:sp>');
  });

  it('assigns unique cNvPr ids (no id="0" remains, starts at 2)', () => {
    const slide: Slide = {
      id: 's1',
      layoutId: 'blank',
      background: { fill: { kind: 'role', role: 'background' } },
      elements: [
        {
          id: 'sh1',
          frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
          type: 'shape',
          data: { kind: 'rect' },
        },
        {
          id: 'sh2',
          frame: { x: 20, y: 20, w: 10, h: 10, rotation: 0 },
          type: 'shape',
          data: { kind: 'ellipse' },
        },
      ],
      notes: [],
    } as unknown as Slide;
    const xml = slideToXml(slide, ctx);
    // No id="0" left in cNvPr elements
    expect(xml).not.toMatch(/<p:cNvPr[^>]*id="0"/);
    // Both elements should have id=2 and id=3
    expect(xml).toContain('id="2"');
    expect(xml).toContain('id="3"');
  });

  it('spidMap couples animation spTgt spid to element cNvPr id', () => {
    const slide: Slide = {
      id: 's1',
      layoutId: 'blank',
      background: { fill: { kind: 'role', role: 'background' } },
      elements: [
        {
          id: 'target-el',
          frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
          type: 'shape',
          data: { kind: 'rect' },
        },
      ],
      notes: [],
      animations: [
        {
          elementId: 'target-el',
          category: 'entrance',
          effect: 'appear',
          start: 'onClick',
          durationMs: 500,
          delayMs: 0,
        },
      ],
    } as unknown as Slide;
    const xml = slideToXml(slide, ctx);
    // The element gets id=2 (first element after spTree root which is 1)
    expect(xml).toContain('id="2"');
    // Animation should reference spid=2
    expect(xml).toContain('spid="2"');
  });

  it('includes background', () => {
    const slide: Slide = {
      id: 's1',
      layoutId: 'blank',
      background: { fill: { kind: 'srgb', value: '#FF0000' } },
      elements: [],
      notes: [],
    } as unknown as Slide;
    const xml = slideToXml(slide, ctx);
    expect(xml).toContain('<p:bg>');
    expect(xml).toContain('FF0000');
  });
});

describe('notesSlideToXml', () => {
  it('starts with XML declaration and emits p:notes', () => {
    const notes: Block[] = [];
    const xml = notesSlideToXml(notes);
    expect(xml).toMatch(/^<\?xml /);
    expect(xml).toContain('<p:notes');
  });
});
