import { describe, it, expect } from 'vitest';
import { tableToXml } from '../../../src/export/pptx/table.js';
import { DEFAULT_BLOCK_STYLE, type Block } from '@wafflebase/docs';
import type { TableElement } from '../../../src/model/element.js';

function cell(text: string) {
  const blocks: Block[] = [{ id: 'b', type: 'paragraph', inlines: [{ text, style: {} }], style: { ...DEFAULT_BLOCK_STYLE } } as Block];
  return { body: { blocks }, style: {} };
}
const el: TableElement = {
  id: 't', frame: { x: 0, y: 0, w: 200, h: 80, rotation: 0 }, type: 'table',
  data: { columnWidths: [100, 100], rows: [{ height: 40, cells: [cell('A'), cell('B')] }, { height: 40, cells: [cell('C'), cell('D')] }] },
};

describe('tableToXml', () => {
  it('emits graphicFrame with grid, rows, and cell text', () => {
    const xml = tableToXml(el);
    expect(xml).toContain('<p:graphicFrame>');
    expect(xml).toContain('<a:tbl>');
    expect(xml.match(/<a:gridCol /g)).toHaveLength(2);
    expect(xml.match(/<a:tr /g)).toHaveLength(2);
    expect(xml).toContain('<a:t>A</a:t>');
  });
  it('marks covered cells with hMerge', () => {
    const merged: TableElement = { ...el, data: { ...el.data, rows: [{ height: 40, cells: [{ ...cell('A'), gridSpan: 2 }, { ...cell(''), gridSpan: 0 }] }] } };
    expect(tableToXml(merged)).toContain('hMerge="1"');
  });
  it('marks covered cells with vMerge', () => {
    const merged: TableElement = {
      ...el,
      data: {
        ...el.data,
        rows: [
          { height: 40, cells: [{ ...cell('A'), rowSpan: 2 }, cell('B')] },
          { height: 40, cells: [{ ...cell(''), rowSpan: 0 }, cell('D')] },
        ],
      },
    };
    const xml = tableToXml(merged);
    expect(xml).toContain('vMerge="1"');
    expect(xml).toContain('rowSpan="2"');
  });
  it('emits anchor cell gridSpan attribute', () => {
    const merged: TableElement = { ...el, data: { ...el.data, rows: [{ height: 40, cells: [{ ...cell('A'), gridSpan: 2 }, { ...cell(''), gridSpan: 0 }] }] } };
    const xml = tableToXml(merged);
    expect(xml).toContain('gridSpan="2"');
  });
  it('emits cell borders in tcPr', () => {
    const withBorder: TableElement = {
      ...el,
      data: {
        ...el.data,
        rows: [{
          height: 40,
          cells: [{
            body: { blocks: [] },
            style: { border: { left: { color: '#FF0000', width: 2 } } },
          }, cell('B')],
        }, { height: 40, cells: [cell('C'), cell('D')] }],
      },
    };
    const xml = tableToXml(withBorder);
    expect(xml).toContain('<a:lnL');
    expect(xml).toContain('FF0000');
  });
  it('emits cell fill in tcPr', () => {
    const withFill: TableElement = {
      ...el,
      data: {
        ...el.data,
        rows: [{
          height: 40,
          cells: [{
            body: { blocks: [] },
            style: { fill: '#00FF00' },
          }, cell('B')],
        }, { height: 40, cells: [cell('C'), cell('D')] }],
      },
    };
    const xml = tableToXml(withFill);
    expect(xml).toContain('<a:solidFill>');
    expect(xml).toContain('00FF00');
  });
  it('escapes id in name attribute', () => {
    const withSpecial: TableElement = { ...el, id: 'a"b' };
    const xml = tableToXml(withSpecial);
    expect(xml).not.toContain('name="a"b"');
    expect(xml).toContain('&quot;');
  });
  it('emits xfrm position', () => {
    const positioned: TableElement = { ...el, frame: { x: 100, y: 50, w: 200, h: 80, rotation: 0 } };
    const xml = tableToXml(positioned);
    // x=100 in a 1920-wide slide → EMU round-trip check
    expect(xml).toContain('<p:xfrm>');
    expect(xml).toContain('<a:off');
    expect(xml).toContain('<a:ext');
  });
  it('emits escaped descr on cNvPr for alt text with special chars', () => {
    const withAlt: TableElement = { ...el, data: { ...el.data, alt: 'A & B "x"' } };
    const xml = tableToXml(withAlt);
    expect(xml).toContain('descr="A &amp; B &quot;x&quot;"');
  });
  it('emits tableStyleId inside tblPr', () => {
    const withStyle: TableElement = { ...el, data: { ...el.data, tableStyleId: 'someId' } };
    const xml = tableToXml(withStyle);
    expect(xml).toContain('<a:tableStyleId>someId</a:tableStyleId>');
    expect(xml).toContain('<a:tblPr>');
  });
});
