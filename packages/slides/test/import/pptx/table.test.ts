// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseTable } from '../../../src/import/pptx/table';
import { ImportReport } from '../../../src/import/pptx/report';
import { DEFAULT_WIDESCREEN_EMU, emuScale } from '../../../src/import/pptx/geometry';
import { parseXml } from '../../../src/import/pptx/xml';
import type { SlideParseContext } from '../../../src/import/pptx/shape';
import type { TableElement } from '../../../src/model/element';

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

function only(out: ReturnType<typeof parseTable>): TableElement {
  expect(out).toHaveLength(1);
  expect(out[0].type).toBe('table');
  return out[0] as TableElement;
}

const SMALL_TABLE = `<p:graphicFrame>
  <p:xfrm><a:off x="1000000" y="2000000"/><a:ext cx="3000000" cy="2000000"/></p:xfrm>
  <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
    <a:tbl>
      <a:tblGrid>
        <a:gridCol w="1000000"/><a:gridCol w="2000000"/>
      </a:tblGrid>
      <a:tr h="1000000">
        <a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>A1</a:t></a:r></a:p></a:txBody></a:tc>
        <a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>B1</a:t></a:r></a:p></a:txBody></a:tc>
      </a:tr>
      <a:tr h="1000000">
        <a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>A2</a:t></a:r></a:p></a:txBody></a:tc>
        <a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>B2</a:t></a:r></a:p></a:txBody></a:tc>
      </a:tr>
    </a:tbl>
  </a:graphicData></a:graphic>
</p:graphicFrame>`;

describe('parseTable — structured TableElement', () => {
  it('returns a single TableElement with rows × cells matching the OOXML grid', () => {
    const t = only(parseTable(frame(SMALL_TABLE), ctx()));
    expect(t.data.columnWidths).toHaveLength(2);
    expect(t.data.columnWidths[0]).toBeCloseTo(1_000_000 * SCALE.sx, 6);
    expect(t.data.columnWidths[1]).toBeCloseTo(2_000_000 * SCALE.sx, 6);
    expect(t.data.rows).toHaveLength(2);
    expect(t.data.rows[0].cells.map((c) => c.body.blocks[0]?.inlines[0]?.text)).toEqual(['A1', 'B1']);
    expect(t.data.rows[1].cells.map((c) => c.body.blocks[0]?.inlines[0]?.text)).toEqual(['A2', 'B2']);
  });

  it('sets frame.x/y from xfrm.off and frame.w/h from the grid (sum of columnWidths / row heights)', () => {
    const t = only(parseTable(frame(SMALL_TABLE), ctx()));
    expect(t.frame.x).toBeCloseTo(1_000_000 * SCALE.sx, 6);
    expect(t.frame.y).toBeCloseTo(2_000_000 * SCALE.sy, 6);
    expect(t.frame.w).toBeCloseTo(3_000_000 * SCALE.sx, 6);
    expect(t.frame.h).toBeCloseTo(2_000_000 * SCALE.sy, 6);
    expect(t.frame.rotation).toBe(0);
  });

  it('honors explicit <a:tcPr marL marR marT marB> as cell padding in px', () => {
    const xml = `<p:graphicFrame>
      <p:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></p:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
        <a:tbl>
          <a:tblGrid><a:gridCol w="2000000"/></a:tblGrid>
          <a:tr h="1000000">
            <a:tc>
              <a:txBody><a:bodyPr/><a:p><a:r><a:t>X</a:t></a:r></a:p></a:txBody>
              <a:tcPr marL="200000" marR="300000" marT="100000" marB="50000"/>
            </a:tc>
          </a:tr>
        </a:tbl>
      </a:graphicData></a:graphic>
    </p:graphicFrame>`;
    const t = only(parseTable(frame(xml), ctx()));
    const cell = t.data.rows[0].cells[0];
    expect(cell.style.padding?.left).toBeCloseTo(200_000 * SCALE.sx, 6);
    expect(cell.style.padding?.right).toBeCloseTo(300_000 * SCALE.sx, 6);
    expect(cell.style.padding?.top).toBeCloseTo(100_000 * SCALE.sy, 6);
    expect(cell.style.padding?.bottom).toBeCloseTo(50_000 * SCALE.sy, 6);
  });

  it('encodes <a:tc gridSpan> and <a:tc hMerge="1"> via gridSpan anchor / 0-marker', () => {
    const xml = `<p:graphicFrame>
      <p:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/></p:xfrm>
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
    const t = only(parseTable(frame(xml), ctx()));
    const [a, b] = t.data.rows[0].cells;
    expect(a.gridSpan).toBe(2);
    expect(b.gridSpan).toBe(0);
  });

  it('encodes <a:tc rowSpan> and <a:tc vMerge="1"> via rowSpan anchor / 0-marker', () => {
    const xml = `<p:graphicFrame>
      <p:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="2000000"/></p:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
        <a:tbl>
          <a:tblGrid><a:gridCol w="1000000"/></a:tblGrid>
          <a:tr h="1000000">
            <a:tc rowSpan="2"><a:txBody><a:bodyPr/><a:p><a:r><a:t>tall</a:t></a:r></a:p></a:txBody></a:tc>
          </a:tr>
          <a:tr h="1000000">
            <a:tc vMerge="1"><a:txBody><a:bodyPr/><a:p/></a:txBody></a:tc>
          </a:tr>
        </a:tbl>
      </a:graphicData></a:graphic>
    </p:graphicFrame>`;
    const t = only(parseTable(frame(xml), ctx()));
    expect(t.data.rows[0].cells[0].rowSpan).toBe(2);
    expect(t.data.rows[1].cells[0].rowSpan).toBe(0);
  });

  it('parses each <a:lnL/R/T/B> into a per-side CellBorder with width and color', () => {
    const xml = `<p:graphicFrame>
      <p:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></p:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
        <a:tbl>
          <a:tblGrid><a:gridCol w="1000000"/></a:tblGrid>
          <a:tr h="1000000">
            <a:tc>
              <a:txBody><a:bodyPr/><a:p/></a:txBody>
              <a:tcPr>
                <a:lnL w="9525"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:lnL>
                <a:lnR w="19050"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:lnR>
                <a:lnT w="9525"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></a:lnT>
                <a:lnB w="9525"><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill></a:lnB>
              </a:tcPr>
            </a:tc>
          </a:tr>
        </a:tbl>
      </a:graphicData></a:graphic>
    </p:graphicFrame>`;
    const t = only(parseTable(frame(xml), ctx()));
    const border = t.data.rows[0].cells[0].style.border;
    expect(border?.left).toMatchObject({ width: expect.any(Number) });
    expect(border?.right?.width).toBeGreaterThan(border?.left?.width ?? 0);
    expect(border?.top).toBeDefined();
    expect(border?.bottom).toBeDefined();
  });

  it('skips a border side encoded with <a:alpha val="0"/> (PowerPoint invisible-border idiom)', () => {
    const xml = `<p:graphicFrame>
      <p:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></p:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
        <a:tbl>
          <a:tblGrid><a:gridCol w="1000000"/></a:tblGrid>
          <a:tr h="1000000">
            <a:tc>
              <a:txBody><a:bodyPr/><a:p/></a:txBody>
              <a:tcPr>
                <a:lnL w="9525"><a:solidFill><a:srgbClr val="9E9E9E"><a:alpha val="0"/></a:srgbClr></a:solidFill></a:lnL>
                <a:lnR w="9525"><a:solidFill><a:srgbClr val="9E9E9E"><a:alpha val="0"/></a:srgbClr></a:solidFill></a:lnR>
                <a:lnT w="9525"><a:solidFill><a:srgbClr val="9E9E9E"><a:alpha val="0"/></a:srgbClr></a:solidFill></a:lnT>
                <a:lnB w="9525"><a:solidFill><a:srgbClr val="9E9E9E"><a:alpha val="0"/></a:srgbClr></a:solidFill></a:lnB>
              </a:tcPr>
            </a:tc>
          </a:tr>
        </a:tbl>
      </a:graphicData></a:graphic>
    </p:graphicFrame>`;
    const t = only(parseTable(frame(xml), ctx()));
    expect(t.data.rows[0].cells[0].style.border).toBeUndefined();
  });

  it('preserves <a:tableStyleId> on data.tableStyleId for future round-trip', () => {
    const xml = `<p:graphicFrame>
      <p:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></p:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
        <a:tbl>
          <a:tblPr><a:tableStyleId>{DD8C9318-929F-40C6-925B-FB3225100E8B}</a:tableStyleId></a:tblPr>
          <a:tblGrid><a:gridCol w="1000000"/></a:tblGrid>
          <a:tr h="1000000">
            <a:tc><a:txBody><a:bodyPr/><a:p/></a:txBody></a:tc>
          </a:tr>
        </a:tbl>
      </a:graphicData></a:graphic>
    </p:graphicFrame>`;
    const t = only(parseTable(frame(xml), ctx()));
    expect(t.data.tableStyleId).toBe('{DD8C9318-929F-40C6-925B-FB3225100E8B}');
  });

  it('maps <a:tcPr anchor="ctr"> to style.verticalAlign="middle"', () => {
    const xml = `<p:graphicFrame>
      <p:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></p:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
        <a:tbl>
          <a:tblGrid><a:gridCol w="1000000"/></a:tblGrid>
          <a:tr h="1000000">
            <a:tc>
              <a:txBody><a:bodyPr/><a:p/></a:txBody>
              <a:tcPr anchor="ctr"/>
            </a:tc>
          </a:tr>
        </a:tbl>
      </a:graphicData></a:graphic>
    </p:graphicFrame>`;
    const t = only(parseTable(frame(xml), ctx()));
    expect(t.data.rows[0].cells[0].style.verticalAlign).toBe('middle');
  });

  it('returns an empty list when the graphicFrame has no <a:tbl>', () => {
    const xml = `<p:graphicFrame>
      <p:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></p:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"/></a:graphic>
    </p:graphicFrame>`;
    expect(parseTable(frame(xml), ctx())).toEqual([]);
  });
});
