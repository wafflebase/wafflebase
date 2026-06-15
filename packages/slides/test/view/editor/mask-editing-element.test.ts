// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { maskEditingElement } from '../../../src/view/editor/editor';
import type {
  Element,
  ShapeElement,
  TextElement,
} from '../../../src/model/element';

function textEl(over: Partial<TextElement> = {}): TextElement {
  return {
    id: 't1',
    type: 'text',
    frame: { x: 0, y: 0, w: 200, h: 100, rotation: 0 },
    data: {
      blocks: [
        {
          id: 'b1',
          type: 'paragraph',
          inlines: [{ text: 'hi', style: {} }],
          style: {},
        },
      ],
      fill: { kind: 'srgb', value: '#00ff00' },
      stroke: { color: '#ff0000', width: 3 },
    },
    ...over,
  } as TextElement;
}

describe('maskEditingElement — text element', () => {
  it('keeps the text box fill and border while editing', () => {
    const out = maskEditingElement([textEl()], 't1', null);
    // The element must survive the mask (not be dropped) so its box
    // decorations keep painting under the overlay editor.
    expect(out).toHaveLength(1);
    const el = out[0] as TextElement;
    expect(el.type).toBe('text');
    expect(el.data.fill).toEqual({ kind: 'srgb', value: '#00ff00' });
    expect(el.data.stroke).toEqual({ color: '#ff0000', width: 3 });
  });

  it('clears the text body so it is not double-painted', () => {
    const out = maskEditingElement([textEl()], 't1', null);
    expect((out[0] as TextElement).data.blocks).toEqual([]);
  });

  it('drops placeholderRef so the ghost hint does not show behind the editor', () => {
    const el = textEl({ placeholderRef: { type: 'title', index: 0 } });
    const out = maskEditingElement([el], 't1', null);
    expect((out[0] as TextElement).placeholderRef).toBeUndefined();
  });

  it('does not mutate the source element', () => {
    const el = textEl();
    maskEditingElement([el], 't1', null);
    expect(el.data.blocks).toHaveLength(1);
  });

  it('leaves non-edited text elements untouched', () => {
    const a = textEl({ id: 't1' });
    const b = textEl({ id: 't2' });
    const out = maskEditingElement([a, b], 't1', null);
    expect(out).toHaveLength(2);
    expect((out[1] as TextElement).data.blocks).toHaveLength(1);
  });
});

describe('maskEditingElement — shape element (regression)', () => {
  function shapeEl(): ShapeElement {
    return {
      id: 's1',
      type: 'shape',
      frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
      data: {
        kind: 'rect',
        fill: { kind: 'srgb', value: '#abc' },
        stroke: { color: '#000', width: 1 },
        text: {
          blocks: [
            {
              id: 'b1',
              type: 'paragraph',
              inlines: [{ text: 'x', style: {} }],
              style: {},
            },
          ],
        },
      },
    } as ShapeElement;
  }

  it('keeps fill/stroke but strips the inline text body', () => {
    const out = maskEditingElement([shapeEl()] as Element[], 's1', null);
    const el = out[0] as ShapeElement;
    expect(el.data.fill).toEqual({ kind: 'srgb', value: '#abc' });
    expect(el.data.stroke).toEqual({ color: '#000', width: 1 });
    expect(el.data.text).toBeUndefined();
  });
});
