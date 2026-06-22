import { describe, it, expect } from 'vitest';
import { imageToXml } from '../../../src/export/pptx/image.js';
import type { ImageElement } from '../../../src/model/element.js';

const base: ImageElement = {
  id: 'i',
  frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
  type: 'image',
  data: { src: 'data:image/png;base64,AAAA' },
};

describe('imageToXml', () => {
  it('emits p:pic with blip embed', () => {
    const xml = imageToXml(base, 'rId5');
    expect(xml).toContain('<p:pic>');
    expect(xml).toContain('r:embed="rId5"');
  });

  it('emits srcRect from crop and alphaModFix from opacity', () => {
    const xml = imageToXml(
      { ...base, data: { ...base.data, crop: { x: 0.1, y: 0.2, w: 0.7, h: 0.6 }, opacity: 0.5 } },
      'rId1',
    );
    expect(xml).toContain('<a:srcRect');
    expect(xml).toMatch(/<a:alphaModFix amt="50000"\/>/);
  });

  it('srcRect l/t/r/b are correct inverse of importer parseSrcRect', () => {
    // crop { x:0.1, y:0.2, w:0.7, h:0.6 } should produce:
    //   l=10000 (x*100000), t=20000, r=20000 ((1-x-w)*100000), b=20000 ((1-y-h)*100000)
    const xml = imageToXml(
      { ...base, data: { ...base.data, crop: { x: 0.1, y: 0.2, w: 0.7, h: 0.6 } } },
      'rId1',
    );
    expect(xml).toContain('l="10000"');
    expect(xml).toContain('t="20000"');
    expect(xml).toContain('r="20000"');
    expect(xml).toContain('b="20000"');
  });

  it('emits grayscl for grayscale recolor', () => {
    const xml = imageToXml(
      { ...base, data: { ...base.data, recolor: 'grayscale' } },
      'rId2',
    );
    expect(xml).toContain('<a:grayscl/>');
  });

  it('emits duotone for sepia recolor', () => {
    const xml = imageToXml(
      { ...base, data: { ...base.data, recolor: 'sepia' } },
      'rId3',
    );
    expect(xml).toContain('<a:duotone>');
    // Sepia canonical tones: dark brown + tan
    expect(xml).toContain('<a:srgbClr val="4C2B1E"/>');
    expect(xml).toContain('<a:srgbClr val="C8A882"/>');
  });

  it('emits lum for brightness and contrast', () => {
    const xml = imageToXml(
      { ...base, data: { ...base.data, brightness: 0.5, contrast: -0.25 } },
      'rId4',
    );
    expect(xml).toContain('bright="50000"');
    expect(xml).toContain('contrast="-25000"');
  });

  it('emits lum for brightness only', () => {
    const xml = imageToXml(
      { ...base, data: { ...base.data, brightness: 0.2 } },
      'rId6',
    );
    expect(xml).toContain('bright="20000"');
    expect(xml).not.toContain('contrast=');
  });

  it('does not emit alphaModFix when opacity is 1', () => {
    const xml = imageToXml(
      { ...base, data: { ...base.data, opacity: 1 } },
      'rId7',
    );
    expect(xml).not.toContain('alphaModFix');
  });

  it('does not emit srcRect when crop is absent', () => {
    const xml = imageToXml(base, 'rId8');
    expect(xml).not.toContain('<a:srcRect');
  });

  it('emits alt text in cNvPr descr attribute', () => {
    const xml = imageToXml(
      { ...base, data: { ...base.data, alt: 'A sample image' } },
      'rId9',
    );
    expect(xml).toContain('descr="A sample image"');
  });

  it('emits effectLst for effects', () => {
    const xml = imageToXml(
      {
        ...base,
        data: {
          ...base.data,
          effects: {
            shadow: {
              color: '#000000',
              opacity: 0.5,
              angle: 0,
              distance: 4,
              blur: 6,
            },
          },
        },
      },
      'rId10',
    );
    expect(xml).toContain('<a:effectLst>');
    expect(xml).toContain('<a:outerShdw');
  });
});
