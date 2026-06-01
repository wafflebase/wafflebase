import { describe, expect, it } from 'vitest';
import { getTextRegionRect } from '../../../src/view/editor/text-box-editor';

describe('getTextRegionRect', () => {
  it('insets a text-element frame by HOVER_TEXT_REGION_INSET_PX on every side', () => {
    const frame = { x: 100, y: 200, w: 300, h: 80, rotation: 0 };
    const rect = getTextRegionRect({ type: 'text' } as never, frame);
    expect(rect).toEqual({ x: 106, y: 206, w: 288, h: 68 });
  });

  it('returns null for elements without a text body', () => {
    const frame = { x: 0, y: 0, w: 100, h: 100, rotation: 0 };
    const rect = getTextRegionRect(
      { type: 'image' } as never,
      frame,
    );
    expect(rect).toBeNull();
  });

  it('returns a region for shapes with a non-empty textBody', () => {
    const frame = { x: 0, y: 0, w: 100, h: 100, rotation: 0 };
    const rect = getTextRegionRect(
      { type: 'shape', data: { text: { blocks: [{ type: 'paragraph', inlines: [] }] } } } as never,
      frame,
    );
    expect(rect).not.toBeNull();
  });

  it('returns null for shapes without a textBody', () => {
    const frame = { x: 0, y: 0, w: 100, h: 100, rotation: 0 };
    const rect = getTextRegionRect(
      { type: 'shape', data: {} } as never,
      frame,
    );
    expect(rect).toBeNull();
  });
});
