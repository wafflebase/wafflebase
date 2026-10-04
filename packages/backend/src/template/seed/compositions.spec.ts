/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- specs inspect untyped element JSON */
import { assertValidSlidesBody } from '../../api/v1/docs-content.controller';
import { deck, slide, SW } from './builders';
import {
  CONTENT_W,
  FOOTER_TOP,
  MARGIN,
  addElements,
  bigNumberCard,
  calloutCard,
  codeBlock,
  diagram,
  footer,
  frameOf,
  kicker,
  svgIntrinsicSize,
  table,
} from './compositions';
import type { Element } from '@wafflebase/slides';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><rect width="400" height="200"/></svg>';

/** Place compositions on a real slide and run the product's own validator. */
function validate(...parts: Element[][]): Element[] {
  const s = addElements(slide('blank', []), ...parts);
  const body = deck('t', [s]);
  expect(() =>
    assertValidSlidesBody(JSON.parse(JSON.stringify(body))),
  ).not.toThrow();
  return s.elements;
}

function inSafeArea(els: Element[], allowFooter = false): void {
  for (const e of els) {
    const f = e.frame;
    expect(f.x).toBeGreaterThanOrEqual(MARGIN);
    expect(f.x + f.w).toBeLessThanOrEqual(SW - MARGIN);
    expect(f.y).toBeGreaterThanOrEqual(0);
    if (!allowFooter) expect(f.y + f.h).toBeLessThanOrEqual(FOOTER_TOP);
  }
}

const textOf = (e: Element): string[] => {
  const d = (e as any).data as { blocks?: any[]; text?: { blocks: any[] } };
  const blocks = d.blocks ?? d.text?.blocks ?? [];
  return blocks.map((b) => b.inlines.map((i: any) => i.text).join(''));
};

describe('slide compositions', () => {
  it('kicker: uppercase label with accent tick, above the title slot', () => {
    const els = validate(kicker('Quarterly review'));
    expect(els).toHaveLength(2);
    expect(textOf(els[1])).toEqual(['QUARTERLY REVIEW']);
    expect(els[1].frame.y + els[1].frame.h).toBeLessThanOrEqual(80);
    inSafeArea(els);
  });

  it('kicker: uppercase can be disabled', () => {
    const [, t] = kicker('Mixed Case', { uppercase: false });
    expect(textOf(t)).toEqual(['Mixed Case']);
  });

  it('calloutCard: callout shape with text, tail reserved inside the box', () => {
    const els = validate(
      calloutCard({ title: 'Note', body: 'one\ntwo', box: { y: 300, h: 300 } }),
    );
    const el = els[0] as any;
    expect(el.data.kind).toBe('wedgeRoundRectCallout');
    expect(textOf(els[0])).toEqual(['Note', 'one', 'two']);
    const tipY = el.data.adjustments[1];
    const tip = el.frame.y + el.frame.h / 2 + (el.frame.h * tipY) / 100000;
    expect(tip).toBeLessThanOrEqual(300 + 300);
    expect(calloutCard({ body: 'x', tail: false })[0]).toMatchObject({
      data: { kind: 'roundRect' },
    });
  });

  it('codeBlock: monospace, one block per line, blank lines and order preserved', () => {
    const code = 'function f() {\n\n  return 1;\n}\n';
    const els = validate(codeBlock(code));
    expect(textOf(els[0])).toEqual(['function f() {', '', '  return 1;', '}']);
    const run = (els[0] as any).data.text.blocks[0].inlines[0].style;
    expect(run.fontFamily).toBe('Courier New');
    expect(els[0].frame.h).toBe(Math.ceil(4 * 28 * 1.4 + 72));
    inSafeArea(els);
  });

  it('codeBlock: normalizes CRLF/tabs, rejects code that cannot fit', () => {
    expect(textOf(codeBlock('a\r\n\tb')[0])).toEqual(['a', '  b']);
    expect(() => codeBlock('x'.repeat(200))).toThrow(/does not fit/);
    expect(() => codeBlock(Array(40).fill('x').join('\n'))).toThrow(
      /safe area/,
    );
  });

  it('table: header + rows, frame equals sum of widths and heights', () => {
    const els = validate(
      table(
        ['Name', 'Qty'],
        [
          ['a', 1],
          ['b', 2],
        ],
      ),
    );
    const t = els[0] as any;
    expect(t.type).toBe('table');
    expect(t.data.rows).toHaveLength(3);
    const w = t.data.columnWidths.reduce((a: number, b: number) => a + b, 0);
    expect(t.frame.w).toBe(w);
    expect(w).toBeLessThanOrEqual(CONTENT_W);
    expect(t.frame.h).toBe(
      t.data.rows.reduce((a: number, r: any) => a + r.height, 0),
    );
    expect(
      t.data.rows[2].cells.map((c: any) => c.body.blocks[0].inlines[0].text),
    ).toEqual(['b', '2']);
  });

  it('table: ragged and empty input is repaired sensibly', () => {
    const t = validate(table(['A'], [['1', '2', '3'], []]))[0] as any;
    expect(t.data.columnWidths).toHaveLength(3);
    for (const r of t.data.rows) expect(r.cells).toHaveLength(3);
    expect(t.data.rows[2].cells[0].body.blocks[0].inlines[0].text).toBe('');
    expect((validate(table(['A', 'B'], []))[0] as any).data.rows).toHaveLength(
      1,
    );
    expect(
      (validate(table([], [['x', 'y']]))[0] as any).data.rows,
    ).toHaveLength(1);
    expect(() => table([], [])).toThrow(/at least one column/);
  });

  it('table: refuses to run into the footer', () => {
    expect(() => table(['A'], Array(30).fill(['x']))).toThrow(/safe area/);
  });

  it('bigNumberCard: number + label in one card with accent bar', () => {
    const els = validate(bigNumberCard('98%', 'Uptime'));
    expect(textOf(els[0])).toEqual(['98%', 'Uptime']);
    expect(els[1].frame).toMatchObject({
      x: els[0].frame.x,
      w: els[0].frame.w,
      h: 12,
    });
    inSafeArea(els);
    const size = (bigNumberCard('$1,234,567,890', 'x')[0] as any).data.text
      .blocks[0].inlines[0].style.fontSize;
    expect(size).toBeLessThan(128);
  });

  it('footer: sits in the footer band, inside the slide', () => {
    const els = validate(footer('Acme Corp', { right: '3 / 10' }));
    expect(els).toHaveLength(3);
    expect(
      els.every(
        (e) => e.frame.y >= FOOTER_TOP && e.frame.y + e.frame.h <= 1080,
      ),
    ).toBe(true);
    expect(textOf(els[2])).toEqual(['3 / 10']);
    inSafeArea(els, true);
  });

  it('diagram: fits and centres the svg; uploaded src wins over the data URI', () => {
    expect(svgIntrinsicSize(SVG)).toEqual({ w: 400, h: 200 });
    expect(svgIntrinsicSize('<svg width="100" height="50"></svg>')).toEqual({
      w: 100,
      h: 50,
    });
    const els = validate(diagram(SVG, { alt: 'arch' }));
    const img = els[0] as any;
    expect(img.type).toBe('image');
    expect(img.data.src).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(img.data.alt).toBe('arch');
    expect(img.frame.w / img.frame.h).toBeCloseTo(2, 1);
    inSafeArea(els);
    const up = diagram(SVG, { src: '/api/images/abc' })[0] as any;
    expect(up.data.src).toBe('/api/images/abc');
    expect(() => diagram('<svg></svg>')).toThrow(/viewBox/);
  });

  it('a slide composed from several pieces validates and does not overlap', () => {
    const kpi = bigNumberCard('12x', 'Faster');
    const call = calloutCard({
      body: 'Ship it',
      box: { x: MARGIN + 600, w: 700 },
    });
    const ft = footer('Acme');
    validate(kicker('Roadmap'), kpi, call, ft);
    const a = frameOf(kpi);
    const b = frameOf(call);
    expect(a.x + a.w).toBeLessThanOrEqual(b.x);
    expect(b.y + b.h).toBeLessThanOrEqual(frameOf(ft).y);
  });
});
