import { describe, it, expect } from 'vitest';
import type { ImageElement } from '../../../src/model/element';
import { imageFilter } from '../../../src/view/canvas/image-renderer';

function data(patch: Partial<ImageElement['data']>): ImageElement['data'] {
  return { src: 'x', ...patch };
}

describe('imageFilter', () => {
  it('returns "none" for an unadjusted image', () => {
    expect(imageFilter(data({}))).toBe('none');
    expect(imageFilter(data({ recolor: 'none', brightness: 0, contrast: 0 }))).toBe(
      'none',
    );
  });

  it('maps grayscale / sepia recolor presets', () => {
    expect(imageFilter(data({ recolor: 'grayscale' }))).toBe('grayscale(1)');
    expect(imageFilter(data({ recolor: 'sepia' }))).toBe('sepia(1)');
  });

  it('maps brightness / contrast deltas to 1 + value multipliers', () => {
    expect(imageFilter(data({ brightness: 0.5 }))).toBe('brightness(1.500)');
    expect(imageFilter(data({ contrast: -0.25 }))).toBe('contrast(0.750)');
  });

  it('clamps brightness / contrast into [-1, 1]', () => {
    expect(imageFilter(data({ brightness: 5 }))).toBe('brightness(2.000)');
    expect(imageFilter(data({ contrast: -5 }))).toBe('contrast(0.000)');
  });

  it('composes recolor + brightness + contrast in order', () => {
    expect(
      imageFilter(data({ recolor: 'grayscale', brightness: 0.2, contrast: 0.1 })),
    ).toBe('grayscale(1) brightness(1.200) contrast(1.100)');
  });
});
