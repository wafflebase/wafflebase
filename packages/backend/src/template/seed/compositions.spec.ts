/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument -- specs inspect untyped element JSON */
import { assertValidSlidesBody } from '../../api/v1/docs-content.controller';
import { deck, slide, SW } from './builders';
import {
  CONTENT_W,
  FOOTER_TOP,
  ICON_NAMES,
  MARGIN,
  PX_PER_PT,
  addElements,
  bigNumberCard,
  calloutCard,
  chart,
  codeBlock,
  diagram,
  flow,
  footer,
  frameOf,
  icon,
  iconPath,
  kicker,
  svgIntrinsicSize,
  table,
  textWidthPx,
} from './compositions';
import {
  SHAPE_TEXT_RECT_FRACTIONS,
  computeConnectorFrame,
  connectionSitesForKind,
} from '@wafflebase/slides';
import type { Element } from '@wafflebase/slides';
import type { IconName } from './compositions';

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
    // fontSize is points: 4 lines × 28pt × 4/3 px × 1.4, plus padding, inside
    // the roundRect's text rectangle.
    const r = SHAPE_TEXT_RECT_FRACTIONS.roundRect!;
    expect(els[0].frame.h).toBe(
      Math.ceil((4 * 28 * PX_PER_PT * 1.4 + 72) / (r.b - r.t)),
    );
    inSafeArea(els);
  });

  it('codeBlock: Hangul switches to a monospace face that has it', () => {
    const run = (code: string, o = {}) =>
      (codeBlock(code, o)[0] as any).data.text.blocks[0].inlines[0].style;
    expect(run('const s = "한글";').fontFamily).toBe('Nanum Gothic Coding');
    expect(run('ascii only').fontFamily).toBe('Courier New');
    expect(run('한글', { fontFamily: 'D2Coding' }).fontFamily).toBe('D2Coding');
    // A Hangul glyph is a full em wide: 45 of them do not fit where 60
    // Latin characters do.
    expect(() => codeBlock('x'.repeat(60))).not.toThrow();
    expect(() => codeBlock('가'.repeat(45))).toThrow(/does not fit/);
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

  it('table: refuses columns too narrow to hold text (e.g. fractions)', () => {
    expect(() =>
      table(['A', 'B'], [['x', 'y']], { columnWidths: [0.3, 0.7] }),
    ).toThrow(/slide px/);
    expect(() =>
      table(['A', 'B'], [['x', 'y']], {
        columnWidths: [40, 600],
        fontSize: 28,
      }),
    ).toThrow(/at least 56px/);
    expect(() =>
      table(['A', 'B'], [['x', 'y']], {
        columnWidths: [56, 600],
        fontSize: 28,
      }),
    ).not.toThrow();
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

  it('bigNumberCard: a Korean unit stays on the number line in a 400px card', () => {
    const els = validate(
      bigNumberCard('87건', '처리 건수', { box: { w: 400, h: 320 } }),
    );
    const card = els[0] as any;
    expect(textOf(els[0])).toEqual(['87건', '처리 건수']);
    const pt = card.data.text.blocks[0].inlines[0].style.fontSize;
    const r = SHAPE_TEXT_RECT_FRACTIONS.roundRect!;
    const inner = (r.r - r.l) * 400 - 64;
    // The estimate (which errs wide) fits the figure on one line…
    expect(textWidthPx('87건', pt, true)).toBeLessThanOrEqual(inner);
    // …and the old sizing rule, which forgot that fontSize is points, did
    // not: at 128pt the figure is wider than the card.
    expect(textWidthPx('87건', 128, true)).toBeGreaterThan(inner);
    expect(pt).toBeLessThan(128);
    inSafeArea(els);
  });

  it('bigNumberCard: throws when the figure cannot fit at the minimum size', () => {
    expect(() =>
      bigNumberCard('1,234,567,890,123,456', 'x', { box: { w: 300 } }),
    ).toThrow(/does not fit/);
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
    // Comma-separated and negative-origin viewBoxes; malformed ones fall
    // through to width/height, or to null.
    expect(svgIntrinsicSize('<svg viewBox="-10,-10,320,180">')).toEqual({
      w: 320,
      h: 180,
    });
    expect(svgIntrinsicSize('<svg viewBox="0 0 x 1">')).toBeNull();
    expect(svgIntrinsicSize('<svg viewBox="0 0 Infinity 100">')).toBeNull();
    expect(svgIntrinsicSize('<svg viewBox="NaN 0 100 100">')).toBeNull();
    expect(
      svgIntrinsicSize(`<svg viewBox="${'1 '.repeat(50_000)}">`),
    ).toBeNull();
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

  describe('flow', () => {
    const lookupOf = (els: Element[]) =>
      new Map(els.map((e) => [e.id, e] as const));
    const shapesOf = (els: Element[]) => els.filter((e) => e.type === 'shape');
    const connectorsOf = (els: Element[]) =>
      els.filter((e) => e.type === 'connector') as any[];

    it('lays nodes in a row and joins them in sequence with attached arrows', () => {
      const els = validate(flow(['Browser', 'API', 'Database']));
      const shapes = shapesOf(els);
      const cons = connectorsOf(els);
      expect(shapes).toHaveLength(3);
      expect(cons).toHaveLength(2);
      // Connectors paint first so no line crosses a box.
      expect(els.slice(0, 2).every((e) => e.type === 'connector')).toBe(true);
      expect(shapes.map((e) => textOf(e)[0])).toEqual([
        'Browser',
        'API',
        'Database',
      ]);
      // Left to right, one lane.
      expect(shapes[0].frame.x).toBeLessThan(shapes[1].frame.x);
      expect(new Set(shapes.map((e) => e.frame.y)).size).toBe(1);
      for (const [k, c] of cons.entries()) {
        expect(c.routing).toBe('straight');
        expect(c.start).toMatchObject({
          kind: 'attached',
          elementId: shapes[k].id,
          siteIndex: 1,
        }); // E
        expect(c.end).toMatchObject({
          kind: 'attached',
          elementId: shapes[k + 1].id,
          siteIndex: 3,
        }); // W
        expect(c.arrowheads.end.kind).toBe('triangle');
        // The stored frame matches the geometry the renderer computes.
        const f = computeConnectorFrame(c, lookupOf(els));
        expect(c.frame.x).toBeCloseTo(f.x, 1);
        expect(c.frame.w).toBeCloseTo(f.w, 1);
      }
      inSafeArea(els);
      // Every colour is a theme role.
      const fill = (shapes[0] as any).data.fill;
      expect(fill.kind).toBe('role');
      expect(cons[0].stroke.color.kind).toBe('role');
    });

    it('column direction stacks top to bottom, exiting S and entering N', () => {
      const els = validate(
        flow(['a', 'b'], undefined, {
          direction: 'column',
          box: { w: 600, h: 500 },
        }),
      );
      const [a, b] = shapesOf(els);
      expect(a.frame.x).toBe(b.frame.x);
      expect(a.frame.y).toBeLessThan(b.frame.y);
      const [c] = connectorsOf(els);
      expect(c.start.siteIndex).toBe(2); // S
      expect(c.end.siteIndex).toBe(0); // N
    });

    it('picks the facing site on shapes with their own site lists', () => {
      const els = flow([{ label: 'Start', shape: 'ellipse' }, 'Next']);
      const [c] = connectorsOf(els);
      const sites = connectionSitesForKind('ellipse');
      expect(sites[c.start.siteIndex].angle).toBeCloseTo(0); // east
    });

    it('branches on lanes with elbows, and loops back edges outside the grid', () => {
      const els = validate(
        flow(
          [
            'Ingest',
            { label: 'Decide', shape: 'diamond' },
            { label: 'Ship', step: 2, lane: 0 },
            { label: 'Rework', step: 2, lane: 1 },
          ],
          [[0, 1], [1, 2], [1, 3], { from: 3, to: 0, dashed: true }],
          { box: { y: 260, h: 500 } },
        ),
      );
      const shapes = shapesOf(els);
      const cons = connectorsOf(els);
      expect(shapes[3].frame.y).toBeGreaterThan(shapes[2].frame.y);
      expect(cons[2].routing).toBe('elbow');
      expect(cons[2].elbowBend).toBeGreaterThan(0);
      expect(cons[2].elbowBend).toBeLessThan(1);
      // The back edge leaves and enters from the bottom (the outer lane side)
      // and is dashed.
      expect(cons[3].routing).toBe('elbow');
      expect(cons[3].start.siteIndex).toBe(2);
      expect(cons[3].end.siteIndex).toBe(2);
      expect(cons[3].stroke.dash).toBe('dashed');
      const loopBottom = cons[3].frame.y + cons[3].frame.h;
      expect(loopBottom).toBeGreaterThan(shapes[3].frame.y + shapes[3].frame.h);
    });

    it('shrinks a long label to fit, and throws when it cannot', () => {
      const long = 'Authentication and authorization service';
      const els = flow([long, 'b', 'c', 'd']);
      const node = shapesOf(els)[0] as any;
      const pt = node.data.text.blocks[0].inlines[0].style.fontSize;
      expect(pt).toBeLessThan(28);
      expect(pt).toBeGreaterThanOrEqual(18);
      expect(() =>
        flow([
          'Supercalifragilisticexpialidocious-service',
          'b',
          'c',
          'd',
          'e',
        ]),
      ).toThrow(/does not fit/);
    });

    it('refuses bad input instead of drawing something wrong', () => {
      expect(() => flow([])).toThrow(/at least one node/);
      expect(() => flow(['a', 'b'], [[0, 5]])).toThrow(/edge 0/);
      expect(() => flow(['a', 'b'], [[1, 1]])).toThrow(/edge 0/);
      expect(() =>
        flow([
          { label: 'a', step: 0 },
          { label: 'b', step: 0 },
        ]),
      ).toThrow(/shares step 0/);
      expect(() => flow(Array.from({ length: 14 }, (_, i) => `n${i}`))).toThrow(
        /leave .* nodes/,
      );
      expect(() => flow(['a'], undefined, { box: { x: 0 } })).toThrow(
        /safe area/,
      );
    });

    it('a single node is a valid flow with no connectors', () => {
      const els = validate(flow(['Only']));
      expect(els).toHaveLength(1);
    });
  });

  describe('chart', () => {
    const allInside = (
      els: Element[],
      box: { x: number; y: number; w: number; h: number },
    ) => {
      for (const e of els) {
        expect(e.frame.x).toBeGreaterThanOrEqual(box.x - 1);
        expect(e.frame.y).toBeGreaterThanOrEqual(box.y - 1);
        expect(e.frame.x + e.frame.w).toBeLessThanOrEqual(box.x + box.w + 1);
        expect(e.frame.y + e.frame.h).toBeLessThanOrEqual(box.y + box.h + 1);
      }
    };
    const box = { x: MARGIN, y: 260, w: 900, h: 600 };

    it('column: one rect per value, scaled to a nice axis, inside the box', () => {
      const els = validate(
        chart(
          'column',
          ['Q1', 'Q2', 'Q3'],
          [{ name: 'Deploys', values: [10, 20, 31] }],
          {
            box,
            title: 'Deploys',
          },
        ),
      );
      const bars = els.filter((e) => /-s0-b\d$/.test(e.id));
      expect(bars).toHaveLength(3);
      expect(bars[2].frame.h).toBeGreaterThan(bars[1].frame.h);
      expect(bars[1].frame.h / bars[0].frame.h).toBeCloseTo(2, 1);
      // Bars share a baseline.
      const base = bars.map((b) => b.frame.y + b.frame.h);
      expect(Math.max(...base) - Math.min(...base)).toBeLessThanOrEqual(1);
      expect(
        els.some((e) => e.type === 'text' && textOf(e)[0] === 'Deploys'),
      ).toBe(true);
      expect(els.some((e) => e.type === 'text' && textOf(e)[0] === '31')).toBe(
        true,
      );
      allInside(els, box);
      expect(els.every((e) => e.type !== 'chart')).toBe(true);
    });

    it('bar: horizontal bars from a shared left edge, legend for two series', () => {
      const els = validate(
        chart(
          'bar',
          ['Payments', 'Search'],
          [
            { name: 'Sev1', values: [3, 1] },
            { name: 'Sev2', values: [8, 5] },
          ],
          { box },
        ),
      );
      const bars = els.filter((e) => /-b\d$/.test(e.id));
      expect(bars).toHaveLength(4);
      expect(new Set(bars.map((b) => b.frame.x)).size).toBe(1);
      expect(
        els.some((e) => e.type === 'text' && textOf(e)[0] === 'Sev2'),
      ).toBe(true);
      allInside(els, box);
    });

    it('line: a stroked open freeform per series, gaps for nulls', () => {
      const els = validate(
        chart(
          'line',
          ['a', 'b', 'c', 'd'],
          [{ name: 'p50', values: [1, 3, null, 2] }],
          { box },
        ),
      );
      const line = els.find((e) => e.id.endsWith('-s0')) as any;
      expect(line.data.kind).toBe('freeform');
      expect(line.data.fill).toBeUndefined();
      expect(line.data.stroke.color).toEqual({ kind: 'role', role: 'accent1' });
      expect(line.data.path.commands.map((c: any) => c.c)).toEqual([
        'M',
        'L',
        'M',
      ]);
      for (const c of line.data.path.commands) {
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.x).toBeLessThanOrEqual(1);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeLessThanOrEqual(1);
      }
      allInside(els, box);
    });

    it('native: emits the model chart element', () => {
      const [el] = validate(
        chart('line', ['a', 'b'], [{ name: 's', values: [1, 2] }], {
          native: true,
          box,
        }),
      ) as any[];
      expect(el.type).toBe('chart');
      expect(el.data).toMatchObject({
        kind: 'line',
        categories: ['a', 'b'],
        legend: 'none',
      });
      expect(el.data.series[0].color).toEqual({
        kind: 'role',
        role: 'accent1',
      });
    });

    it('refuses data it cannot draw faithfully', () => {
      expect(() => chart('column', [], [{ values: [] }])).toThrow(
        /at least one/,
      );
      expect(() => chart('column', ['a', 'b'], [{ values: [1] }])).toThrow(
        /1 values for 2/,
      );
      expect(() => chart('column', ['a'], [{ values: [-1] }])).toThrow(
        /negative/,
      );
      expect(() => chart('column', ['a'], [{ values: [NaN] }])).toThrow(
        /non-finite/,
      );
      expect(() =>
        chart(
          'column',
          Array.from({ length: 12 }, () => 'A very long category'),
          [{ values: Array(12).fill(1) }],
          { box: { w: 600 } },
        ),
      ).toThrow(/does not fit/);
    });
  });

  describe('icon', () => {
    it.each(ICON_NAMES)('%s is a well-formed normalized path', (name) => {
      const cmds = iconPath(name);
      expect(cmds[0].c).toBe('M');
      let pen: { x: number; y: number } | null = null;
      for (const c of cmds as any[]) {
        if (c.c === 'A') {
          // OOXML arcTo is pen-relative: the arc must start at the pen.
          const sx = c.cx + c.rx * Math.cos(c.start);
          const sy = c.cy + c.ry * Math.sin(c.start);
          expect(pen).not.toBeNull();
          expect(sx).toBeCloseTo(pen!.x, 6);
          expect(sy).toBeCloseTo(pen!.y, 6);
          pen = {
            x: c.cx + c.rx * Math.cos(c.start + c.sweep),
            y: c.cy + c.ry * Math.sin(c.start + c.sweep),
          };
        } else if (c.c !== 'Z') {
          expect(c.x).toBeGreaterThanOrEqual(0);
          expect(c.x).toBeLessThanOrEqual(1);
          expect(c.y).toBeGreaterThanOrEqual(0);
          expect(c.y).toBeLessThanOrEqual(1);
          pen = { x: c.x, y: c.y };
        }
      }
    });

    it('ships the documented set', () => {
      expect(ICON_NAMES).toHaveLength(16);
      expect(ICON_NAMES).toEqual(
        expect.arrayContaining([
          'check',
          'cross',
          'database',
          'cloud',
          'lock',
          'arrow-right',
        ]),
      );
    });

    it('is a square stroked freeform in a theme role, centred in its box', () => {
      const [el] = validate(
        icon('database', {
          box: { x: 200, y: 300, w: 200, h: 100 },
          color: 'accent2',
        }),
      ) as any[];
      expect(el.type).toBe('shape');
      expect(el.data.kind).toBe('freeform');
      expect(el.data.fill).toBeUndefined();
      expect(el.data.stroke.color).toEqual({ kind: 'role', role: 'accent2' });
      expect(el.frame).toMatchObject({ x: 250, y: 300, w: 100, h: 100 });
    });

    it('background draws a disc behind a smaller icon', () => {
      const els = validate(
        icon('lock', { background: 'accent1', color: 'background' }),
      );
      expect(els).toHaveLength(2);
      expect((els[0] as any).data.kind).toBe('ellipse');
      expect(els[1].frame.w).toBeLessThan(els[0].frame.w);
      inSafeArea(els);
    });

    it('rejects unknown names and unsafe boxes', () => {
      expect(() => icon('rocket' as IconName)).toThrow(/unknown icon/);
      expect(() => icon('constructor' as IconName)).toThrow(/unknown icon/);
      expect(() => icon('check', { box: { x: 10 } })).toThrow(/safe area/);
    });
  });

  it('frameOf refuses an empty composition', () => {
    expect(() => frameOf([])).toThrow(/empty composition/);
  });
});
