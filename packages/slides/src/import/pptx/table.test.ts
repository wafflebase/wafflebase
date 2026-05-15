// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseTable } from './table';
import { ImportReport } from './report';
import { DEFAULT_WIDESCREEN_EMU, emuScale } from './geometry';
import { parseXml } from './xml';
import type { SlideParseContext } from './shape';
import type { ShapeElement, TextElement } from '../../model/element';

const SCALE = emuScale(DEFAULT_WIDESCREEN_EMU);

function frame(xml: string): Element {
  return parseXml(
    `<root xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${xml}</root>`,
  ).documentElement.firstElementChild!;
}

function ctx(report = new ImportReport()): SlideParseContext {
  return {
    archive: { readText: async () => undefined, readBytes: async () => undefined, list: () => [] },
    slidePartPath: 'ppt/slides/slide1.xml',
    rels: new Map(),
    scale: SCALE,
    report,
    idMap: new Map(),
    placeholderSizes: new Map(),
    clrMap: new Map(),
  };
}

const SMALL_TABLE = `<p:graphicFrame>
  <p:xfrm><a:off x="1000000" y="2000000"/><a:ext cx="3000000" cy="2000000"/></p:xfrm>
  <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
    <a:tbl>
      <a:tblGrid>
        <a:gridCol w="1000000"/><a:gridCol w="2000000"/>
      </a:tblGrid>
      <a:tr h="1000000">
        <a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>A1</a:t></a:r></a:p></a:txBody>
              <a:tcPr><a:lnL w="9525"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:lnL></a:tcPr></a:tc>
        <a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>B1</a:t></a:r></a:p></a:txBody></a:tc>
      </a:tr>
      <a:tr h="1000000">
        <a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>A2</a:t></a:r></a:p></a:txBody></a:tc>
        <a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>B2</a:t></a:r></a:p></a:txBody></a:tc>
      </a:tr>
    </a:tbl>
  </a:graphicData></a:graphic>
</p:graphicFrame>`;

describe('parseTable', () => {
  it('flattens a 2×2 table into cell text + a border on at least one cell', () => {
    const report = new ImportReport();
    const out = parseTable(frame(SMALL_TABLE), ctx(report));
    const texts = out.filter((e) => e.type === 'text') as TextElement[];
    const borders = out.filter((e) => e.type === 'shape') as ShapeElement[];
    expect(texts).toHaveLength(4);
    expect(texts.map((t) => t.data.blocks[0].inlines[0].text)).toEqual(['A1', 'B1', 'A2', 'B2']);
    expect(borders.length).toBeGreaterThanOrEqual(1);
    expect(report.tablesFlattened).toBe(1);
    expect(report.tableBordersApproximated).toBeGreaterThanOrEqual(1);
  });

  it('positions cells using cumulative col/row widths from the grid', () => {
    const out = parseTable(frame(SMALL_TABLE), ctx());
    const texts = out.filter((e) => e.type === 'text') as TextElement[];
    // A1 at top-left of the table.
    expect(texts[0].frame.x).toBeCloseTo(1_000_000 * SCALE.sx, 6);
    expect(texts[0].frame.y).toBeCloseTo(2_000_000 * SCALE.sy, 6);
    // B1 to the right by 1000000 EMU.
    expect(texts[1].frame.x).toBeCloseTo(2_000_000 * SCALE.sx, 6);
    // A2 below row 1.
    expect(texts[2].frame.y).toBeCloseTo(3_000_000 * SCALE.sy, 6);
  });

  it('counts merges via gridSpan/rowSpan/vMerge', () => {
    const xml = `<p:graphicFrame>
      <p:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="2000000"/></p:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
        <a:tbl>
          <a:tblGrid><a:gridCol w="1000000"/><a:gridCol w="1000000"/></a:tblGrid>
          <a:tr h="1000000">
            <a:tc gridSpan="2"><a:txBody><a:bodyPr/><a:p><a:r><a:t>spans</a:t></a:r></a:p></a:txBody></a:tc>
            <a:tc hMerge="1"><a:txBody><a:bodyPr/><a:p/></a:txBody></a:tc>
          </a:tr>
        </a:tbl>
      </a:graphicData></a:graphic>
    </p:graphicFrame>`;
    const report = new ImportReport();
    parseTable(frame(xml), ctx(report));
    // gridSpan=2 on the owning cell counts once; the cell it covers is
    // skipped via column-index advance, so the matching `hMerge=1`
    // placeholder is no longer double-counted.
    expect(report.tableMergesIgnored).toBe(1);
  });
});
