import { describe, it, expect } from 'vitest';
import { textBodyToXml } from '../../../src/export/pptx/text.js';
import { DEFAULT_BLOCK_STYLE, type Block } from '@wafflebase/docs';

function para(text: string, style: Record<string, unknown> = {}): Block {
  return {
    id: 'b',
    type: 'paragraph',
    inlines: [{ text, style }],
    style: { ...DEFAULT_BLOCK_STYLE },
  } as Block;
}

describe('textBodyToXml', () => {
  it('emits bodyPr autofit and a run', () => {
    const xml = textBodyToXml({ blocks: [para('Hi')], autofit: 'shrink', verticalAnchor: 'middle' });
    expect(xml).toContain('<a:bodyPr');
    expect(xml).toContain('anchor="ctr"');
    expect(xml).toContain('<a:normAutofit/>');
    expect(xml).toContain('<a:t>Hi</a:t>');
  });

  it('emits run properties for bold/italic/size/color', () => {
    const xml = textBodyToXml({ blocks: [para('X', { bold: true, italic: true, fontSize: 24, color: '#FF0000' })] });
    expect(xml).toMatch(/<a:rPr[^>]*b="1"/);
    expect(xml).toMatch(/<a:rPr[^>]*i="1"/);
    expect(xml).toMatch(/<a:rPr[^>]*sz="2400"/);
    expect(xml).toContain('<a:srgbClr val="FF0000"/>');
  });

  it('escapes text', () => {
    expect(textBodyToXml({ blocks: [para('a < b & c')] })).toContain('<a:t>a &lt; b &amp; c</a:t>');
  });

  it('defaults absent autofit to spAutoFit', () => {
    expect(textBodyToXml({ blocks: [para('x')] })).toContain('<a:spAutoFit/>');
  });

  it('uses p:txBody wrapper when tag is p:txBody', () => {
    const xml = textBodyToXml({ blocks: [para('Hello')] }, 'p:txBody');
    expect(xml).toMatch(/^<p:txBody>/);
    expect(xml).toMatch(/<\/p:txBody>$/);
    expect(xml).toContain('<a:t>Hello</a:t>');
  });

  it('emits underline and strikethrough', () => {
    const xml = textBodyToXml({
      blocks: [para('U', { underline: true, strikethrough: true })],
    });
    expect(xml).toMatch(/<a:rPr[^>]*u="sng"/);
    expect(xml).toMatch(/<a:rPr[^>]*strike="sngStrike"/);
  });

  it('emits font family', () => {
    const xml = textBodyToXml({ blocks: [para('F', { fontFamily: 'Arial' })] });
    expect(xml).toContain('<a:latin typeface="Arial"/>');
  });

  it('escapes double-quotes in fontFamily attribute', () => {
    const xml = textBodyToXml({ blocks: [para('Q', { fontFamily: 'Foo "Bar" Sans' })] });
    expect(xml).toContain('typeface="Foo &quot;Bar&quot; Sans"');
    expect(xml).not.toMatch(/typeface="[^"]*"[^/]/);
  });

  it('handles srgb StoredColor object', () => {
    const xml = textBodyToXml({
      blocks: [para('C', { color: { kind: 'srgb', value: '#00FF00' } })],
    });
    expect(xml).toContain('<a:srgbClr val="00FF00"/>');
  });

  it('handles role StoredColor object (theme color)', () => {
    const xml = textBodyToXml({
      blocks: [para('T', { color: { kind: 'role', role: 'text' } })],
    });
    expect(xml).toContain('<a:schemeClr val="tx1"/>');
  });

  it('emits noAutofit for autofit none and anchor bottom', () => {
    const xml = textBodyToXml({ blocks: [para('N')], autofit: 'none', verticalAnchor: 'bottom' });
    expect(xml).toContain('<a:noAutofit/>');
    expect(xml).toContain('anchor="b"');
  });

  it('emits anchor t for top vertical anchor', () => {
    const xml = textBodyToXml({ blocks: [para('T')], verticalAnchor: 'top' });
    expect(xml).toContain('anchor="t"');
  });

  it('emits paragraph alignment', () => {
    const block: Block = {
      id: 'b',
      type: 'paragraph',
      inlines: [{ text: 'A', style: {} }],
      style: { ...DEFAULT_BLOCK_STYLE, alignment: 'center' },
    };
    const xml = textBodyToXml({ blocks: [block] });
    expect(xml).toContain('algn="ctr"');
  });

  it('emits spcBef/spcAft from top/bottom margins (px → spcPts)', () => {
    const block: Block = {
      id: 'b',
      type: 'paragraph',
      inlines: [{ text: 'A', style: {} }],
      // 8 px → 6pt (val 600); 21.333 px → 16pt (val 1600).
      style: { ...DEFAULT_BLOCK_STYLE, marginTop: 8, marginBottom: 21.3333 },
    };
    const xml = textBodyToXml({ blocks: [block] });
    expect(xml).toContain('<a:spcBef><a:spcPts val="600"/></a:spcBef>');
    expect(xml).toContain('<a:spcAft><a:spcPts val="1600"/></a:spcAft>');
  });

  it('omits spcBef/spcAft when margins are zero', () => {
    const block: Block = {
      id: 'b',
      type: 'paragraph',
      inlines: [{ text: 'A', style: {} }],
      style: { ...DEFAULT_BLOCK_STYLE, marginTop: 0, marginBottom: 0 },
    };
    const xml = textBodyToXml({ blocks: [block] });
    expect(xml).not.toContain('<a:spcBef>');
    expect(xml).not.toContain('<a:spcAft>');
  });

  it('emits ordered list bullet', () => {
    const block: Block = {
      id: 'b',
      type: 'list-item',
      inlines: [{ text: 'I', style: {} }],
      style: { ...DEFAULT_BLOCK_STYLE },
      listKind: 'ordered',
      listLevel: 1,
    };
    const xml = textBodyToXml({ blocks: [block] });
    expect(xml).toContain('<a:buAutoNum type="arabicPeriod"/>');
    expect(xml).toContain('lvl="1"');
  });

  it('emits unordered list bullet', () => {
    const block: Block = {
      id: 'b',
      type: 'list-item',
      inlines: [{ text: 'U', style: {} }],
      style: { ...DEFAULT_BLOCK_STYLE },
      listKind: 'unordered',
    };
    const xml = textBodyToXml({ blocks: [block] });
    expect(xml).toContain('<a:buChar char="•"/>');
  });

  it('falls back to black for an unknown role string (no val="undefined")', () => {
    // StoredColor.role is open (string), so an out-of-set value can arrive
    // at runtime. Verify the bridge emits a valid srgbClr instead of the
    // broken <a:schemeClr val="undefined"/> that the old `c as any` path
    // would have produced.
    const unknownColor = { kind: 'role', role: 'somethingUnknown' } as Parameters<typeof textBodyToXml>[0]['blocks'][0]['inlines'][0]['style']['color'];
    const xml = textBodyToXml({ blocks: [para('X', { color: unknownColor })] });
    expect(xml).not.toContain('val="undefined"');
    expect(xml).toContain('<a:srgbClr val="000000"/>');
  });

  it('does not emit hlinkClick for a run with href set', () => {
    // Hyperlink wiring is deferred; no <a:hlinkClick> node must be emitted
    // (an empty r:id="" would produce an invalid relationship reference).
    const xml = textBodyToXml({ blocks: [para('Link', { href: 'https://example.com' })] });
    expect(xml).not.toContain('<a:hlinkClick');
    expect(xml).not.toContain('hlinkClick');
  });
});
