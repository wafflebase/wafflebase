// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  parseEffects,
  parseImageAdjustments,
  readAltText,
} from '../../../src/import/pptx/effects';
import { parsePic, toBackgroundImage } from '../../../src/import/pptx/image';
import { parseSlide } from '../../../src/import/pptx/slide';
import { ImportReport } from '../../../src/import/pptx/report';
import {
  emuScale,
  DEFAULT_WIDESCREEN_EMU,
} from '../../../src/import/pptx/geometry';
import { parseXml } from '../../../src/import/pptx/xml';
import type { PptxArchive } from '../../../src/import/pptx/unzip';

const UNIT = { sx: 1, sy: 1 };

/** Parse an XML fragment and return its first element child. */
function frag(xml: string): Element {
  const el = parseXml(
    `<root xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${xml}</root>`,
  ).documentElement.firstElementChild;
  if (!el) throw new Error(`frag(): no element child in fragment: ${xml}`);
  return el;
}

function fakeArchive(media: Record<string, Uint8Array>): PptxArchive {
  return {
    readText: async () => undefined,
    readBytes: async (path) => media[path],
    list: () => Object.keys(media),
  };
}

describe('parseEffects', () => {
  it('maps <a:outerShdw> to a DropShadow (dir → rad, dist/blur → px, alpha → opacity)', () => {
    const spPr = frag(`<p:spPr>
      <a:effectLst>
        <a:outerShdw blurRad="40000" dist="50800" dir="2700000">
          <a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr>
        </a:outerShdw>
      </a:effectLst>
    </p:spPr>`);
    const effects = parseEffects(spPr, UNIT);
    expect(effects?.shadow).toEqual({
      color: { kind: 'srgb', value: '#FF0000' },
      opacity: 0.5,
      angle: Math.PI / 4,
      distance: 50800,
      blur: 40000,
    });
  });

  it('defaults shadow opacity to 1 when the color carries no <a:alpha>', () => {
    const spPr = frag(`<p:spPr>
      <a:effectLst><a:outerShdw dist="0"><a:srgbClr val="000000"/></a:outerShdw></a:effectLst>
    </p:spPr>`);
    expect(parseEffects(spPr, UNIT)?.shadow?.opacity).toBe(1);
  });

  it('resolves a schemeClr shadow color through the clrMap', () => {
    const spPr = frag(`<p:spPr>
      <a:effectLst><a:outerShdw><a:schemeClr val="accent1"/></a:outerShdw></a:effectLst>
    </p:spPr>`);
    expect(parseEffects(spPr, UNIT, new Map())?.shadow?.color).toEqual({
      kind: 'role',
      role: 'accent1',
    });
  });

  it('maps <a:reflection> (stA → opacity, dist → px, endPos → size)', () => {
    const spPr = frag(`<p:spPr>
      <a:effectLst><a:reflection stA="60000" dist="40000" endPos="35000"/></a:effectLst>
    </p:spPr>`);
    expect(parseEffects(spPr, UNIT)?.reflection).toEqual({
      opacity: 0.6,
      distance: 40000,
      size: 0.35,
    });
  });

  it('returns undefined when neither outerShdw nor reflection is present', () => {
    expect(parseEffects(frag(`<p:spPr><a:effectLst/></p:spPr>`), UNIT)).toBeUndefined();
    expect(parseEffects(frag(`<p:spPr/>`), UNIT)).toBeUndefined();
    expect(parseEffects(undefined, UNIT)).toBeUndefined();
  });
});

describe('readAltText', () => {
  it('reads <p:cNvPr descr> from a shape nv container', () => {
    const sp = frag(`<p:sp>
      <p:nvSpPr><p:cNvPr id="2" name="Rect" descr="A red box"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    </p:sp>`);
    expect(readAltText(sp)).toBe('A red box');
  });

  it('reads alt from a picture nv container', () => {
    const pic = frag(`<p:pic>
      <p:nvPicPr><p:cNvPr id="3" name="Pic" descr="Logo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
    </p:pic>`);
    expect(readAltText(pic)).toBe('Logo');
  });

  it('treats an empty or missing descr as no alt', () => {
    expect(
      readAltText(frag(`<p:sp><p:nvSpPr><p:cNvPr id="2" name="x" descr=""/></p:nvSpPr></p:sp>`)),
    ).toBeUndefined();
    expect(
      readAltText(frag(`<p:sp><p:nvSpPr><p:cNvPr id="2" name="x"/></p:nvSpPr></p:sp>`)),
    ).toBeUndefined();
  });
});

describe('parseImageAdjustments', () => {
  it('maps <a:grayscl> to grayscale recolor', () => {
    expect(parseImageAdjustments(frag(`<a:blip><a:grayscl/></a:blip>`))).toEqual({
      recolor: 'grayscale',
    });
  });

  it('maps a warm <a:duotone> to sepia and a neutral one to grayscale', () => {
    const sepia = frag(
      `<a:blip><a:duotone><a:prstClr val="black"/><a:srgbClr val="C0A060"/></a:duotone></a:blip>`,
    );
    expect(parseImageAdjustments(sepia)).toEqual({ recolor: 'sepia' });
    const neutral = frag(
      `<a:blip><a:duotone><a:srgbClr val="000000"/><a:srgbClr val="FFFFFF"/></a:duotone></a:blip>`,
    );
    expect(parseImageAdjustments(neutral)).toEqual({ recolor: 'grayscale' });
  });

  it('maps <a:lum bright/contrast> to [-1, 1] adjustments', () => {
    expect(
      parseImageAdjustments(frag(`<a:blip><a:lum bright="70000" contrast="-30000"/></a:blip>`)),
    ).toEqual({ brightness: 0.7, contrast: -0.3 });
  });

  it('returns undefined for a blip with no adjustment children', () => {
    expect(parseImageAdjustments(frag(`<a:blip r:embed="rId1"/>`))).toBeUndefined();
    expect(parseImageAdjustments(undefined)).toBeUndefined();
  });
});

describe('parsePic — effects, adjustments, alt', () => {
  const PIC = `<p:pic>
    <p:nvPicPr><p:cNvPr id="5" name="Photo" descr="A cat"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
    <p:blipFill>
      <a:blip r:embed="rId3"><a:grayscl/><a:lum bright="20000"/></a:blip>
      <a:stretch><a:fillRect/></a:stretch>
    </p:blipFill>
    <p:spPr>
      <a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>
      <a:effectLst><a:outerShdw dist="25400" dir="0"><a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr></a:outerShdw></a:effectLst>
    </p:spPr>
  </p:pic>`;

  it('attaches recolor/brightness from the blip and shadow+alt from the host', async () => {
    const result = await parsePic(frag(PIC), {
      archive: fakeArchive({ 'ppt/media/image1.png': new Uint8Array([1]) }),
      slidePartPath: 'ppt/slides/slide1.xml',
      rels: new Map([
        ['rId3', { type: 'image', target: '../media/image1.png', external: false }],
      ]),
      uploadImage: async () => 'u',
      scale: emuScale(DEFAULT_WIDESCREEN_EMU),
      report: new ImportReport(),
    });
    expect(result?.type).toBe('image');
    expect(result?.data.recolor).toBe('grayscale');
    expect(result?.data.brightness).toBe(0.2);
    expect(result?.data.alt).toBe('A cat');
    expect(result?.data.effects?.shadow?.opacity).toBe(0.4);
    expect(result?.data.effects?.shadow?.color).toEqual({ kind: 'srgb', value: '#000000' });
  });
});

describe('toBackgroundImage', () => {
  it('keeps src/opacity/crop and drops foreground-only adjustments', () => {
    expect(
      toBackgroundImage({
        src: 'u',
        opacity: 0.5,
        crop: { x: 0, y: 0, w: 1, h: 1 },
        recolor: 'grayscale',
        brightness: 0.3,
        contrast: -0.2,
      }),
    ).toEqual({ src: 'u', opacity: 0.5, crop: { x: 0, y: 0, w: 1, h: 1 } });
  });

  it('omits absent optional fields', () => {
    expect(toBackgroundImage({ src: 'u' })).toEqual({ src: 'u' });
  });
});

describe('parseSlide — shape effects + alt wiring', () => {
  const SLIDE = `<?xml version="1.0"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Box" descr="Shadowed box"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          <a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill>
          <a:effectLst>
            <a:outerShdw dist="50800" dir="2700000"><a:srgbClr val="333333"><a:alpha val="60000"/></a:srgbClr></a:outerShdw>
            <a:reflection stA="50000" endPos="40000"/>
          </a:effectLst>
        </p:spPr>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;

  it('attaches parsed effects and alt to the emitted ShapeElement', async () => {
    const slide = await parseSlide({
      archive: { readText: async () => SLIDE, readBytes: async () => undefined, list: () => [] },
      partPath: 'ppt/slides/slide1.xml',
      layoutMap: new Map(),
      scale: { sx: 1, sy: 1 },
      report: new ImportReport(),
      clrMap: new Map(),
    });
    const el = slide!.elements[0];
    expect(el.type).toBe('shape');
    if (el.type !== 'shape') return;
    expect(el.data.alt).toBe('Shadowed box');
    expect(el.data.effects?.shadow?.opacity).toBe(0.6);
    expect(el.data.effects?.shadow?.color).toEqual({ kind: 'srgb', value: '#333333' });
    expect(el.data.effects?.reflection).toEqual({ opacity: 0.5, distance: 0, size: 0.4 });
  });
});
