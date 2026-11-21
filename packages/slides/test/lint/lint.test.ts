import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BLOCK_STYLE,
  type Block,
  type ResolvedFont,
  type TextMeasurer,
} from '@wafflebase/docs';
import { applyAllowlist, lintSlides } from '../../src/lint/index';
import { layoutReport } from '../../src/lint/layout-report';
import { contrastRatio, parseCssColor } from '../../src/lint/color';
import type { AutofitMode, Element } from '../../src/model/element';
import type { Slide, SlidesDocument } from '../../src/model/presentation';
import type { Fill } from '../../src/model/theme';
import { defaultLight } from '../../src/themes/default-light';
import type { LintOptions } from '../../src/lint/types';

// Deterministic: every character is 0.5 em.
const measurer: TextMeasurer = {
  measureWidth: (text: string, font: ResolvedFont) => text.length * font.size * 0.5,
};

const frame = (x: number, y: number, w: number, h: number) => ({ x, y, w, h, rotation: 0 });

function para(text: string, fontSize = 24, color?: string, bold = false): Block {
  return {
    id: `b-${text.slice(0, 8)}-${fontSize}`,
    type: 'paragraph',
    inlines: [{ text, style: { fontSize, ...(color ? { color } : {}), ...(bold ? { bold } : {}) } }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}

function text(
  id: string,
  f: ReturnType<typeof frame>,
  body: string | Block[],
  opts: { autofit?: AutofitMode; fill?: string; align?: 'left' | 'center' } = {},
): Element {
  const blocks = typeof body === 'string' ? [para(body)] : body;
  if (opts.align) for (const b of blocks) b.style = { ...b.style, alignment: opts.align };
  return {
    id,
    type: 'text',
    frame: f,
    data: {
      blocks,
      ...(opts.autofit ? { autofit: opts.autofit } : {}),
      ...(opts.fill ? { fill: { kind: 'srgb', value: opts.fill } } : {}),
    },
  } as Element;
}

function rect(id: string, f: ReturnType<typeof frame>, fill?: Fill): Element {
  return { id, type: 'shape', frame: f, data: { kind: 'rect', ...(fill ? { fill } : {}) } } as Element;
}

function image(id: string, f: ReturnType<typeof frame>): Element {
  return { id, type: 'image', frame: f, data: { src: 'data:,' } } as Element;
}

function deck(
  slides: Element[][],
  meta: Partial<SlidesDocument['meta']> = {},
  background = '#ffffff',
): SlidesDocument {
  return {
    meta: { title: 't', themeId: defaultLight.id, masterId: 'm', ...meta },
    themes: [defaultLight],
    masters: [],
    layouts: [],
    guides: [],
    slides: slides.map(
      (elements, i): Slide => ({
        id: `s${i + 1}`,
        layoutId: 'l',
        background: { fill: { kind: 'srgb', value: background } },
        elements,
        notes: [],
      }),
    ),
  };
}

const lint = (d: SlidesDocument, opts: LintOptions = {}) => lintSlides(d, { measurer, ...opts });
const rules = (d: SlidesDocument, ...r: NonNullable<LintOptions['rules']>) => lint(d, { rules: r });

describe('lintSlides', () => {
  it('returns nothing for a clean slide', () => {
    expect(lint(deck([[text('t', frame(200, 200, 800, 200), 'Hello')]]))).toEqual([]);
  });

  it('treats a slide without `elements` as empty instead of crashing', () => {
    const d = deck([[]]);
    delete (d.slides[0] as Partial<Slide>).elements;
    expect(lint(d)).toEqual([]);
    expect(layoutReport(d)[0].elements).toEqual([]);
  });

  it('orders findings by slide and carries id, index and text', () => {
    const d = deck([
      [text('a', frame(200, 200, 600, 100), 'pale', {}),],
      [text('b', frame(200, 200, 600, 100), [para('pale', 24, '#dddddd')])],
    ]);
    const f = rules(d, 'contrast');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ slideId: 's2', slideIndex: 1, elementId: 'b', text: 'pale' });
  });
});

describe('contrast', () => {
  it('flags light text on a light background with the measured ratio', () => {
    const d = deck([[text('t', frame(200, 200, 600, 100), [para('pale', 24, '#bbbbbb')])]]);
    const [f] = rules(d, 'contrast');
    expect(f).toMatchObject({ rule: 'contrast', severity: 'error', elementId: 't' });
    expect(f.message).toMatch(/1\.9:1, needs 4\.5:1/);
  });

  it('holds large text to 3:1 only', () => {
    // #949494 on white is ~3.0:1: fails body text, passes large text (≥ 18pt).
    const small = deck([[text('t', frame(200, 200, 900, 100), [para('mid', 24, '#949494')])]]);
    const large = deck([[text('t', frame(200, 200, 900, 200), [para('mid', 40, '#949494')])]]);
    expect(rules(small, 'contrast')).toHaveLength(1);
    expect(rules(large, 'contrast')).toEqual([]);
  });

  it('reads a group child\'s backdrop from its group siblings painted before it', () => {
    // A card group: dark rect, then white text over it. Fine inside the
    // group; the same white text on the white slide alone would fail.
    const group = (children: Element[]) =>
      ({
        id: 'g',
        type: 'group',
        frame: frame(100, 100, 1000, 400),
        data: { children, refSize: { w: 1000, h: 400 } },
      }) as unknown as Element;
    const card = deck([
      [
        group([
          rect('card', frame(0, 0, 1000, 400), { kind: 'srgb', value: '#202124' }),
          text('label', frame(100, 100, 600, 100), [para('Label', 24, '#ffffff')]),
        ]),
      ],
    ]);
    expect(rules(card, 'contrast')).toEqual([]);
    const bare = deck([
      [group([text('label', frame(100, 100, 600, 100), [para('Label', 24, '#ffffff')])])],
    ]);
    expect(rules(bare, 'contrast')).toEqual([
      expect.objectContaining({ elementId: 'label', severity: 'error' }),
    ]);
  });

  it('reads the backdrop from a filled shape under the text', () => {
    const d = deck([
      [
        rect('bg', frame(100, 100, 1000, 400), { kind: 'srgb', value: '#00a8cc' }),
        text('t', frame(200, 200, 600, 100), [para('Workshop', 24, '#fbfcfd')]),
      ],
    ]);
    const [f] = rules(d, 'contrast');
    expect(f.message).toMatch(/#fbfcfd on #00a8cc is 2\.7:1/);
  });

  it('judges a gradient by its worst stop', () => {
    const grad: Fill = {
      kind: 'gradient',
      type: 'linear',
      angle: 0,
      stops: [
        { pos: 0, color: { kind: 'srgb', value: '#000000' } },
        { pos: 1, color: { kind: 'srgb', value: '#ffffff' } },
      ],
    };
    const d = deck([
      [rect('g', frame(0, 0, 1920, 1080), grad), text('t', frame(200, 200, 600, 100), [para('x', 24, '#ffffff')])],
    ]);
    expect(rules(d, 'contrast')[0].message).toMatch(/on #ffffff is 1:1/);
  });

  it('skips text over an image, whose pixels are unknown', () => {
    const d = deck([
      [image('i', frame(0, 0, 1920, 1080)), text('t', frame(200, 200, 600, 100), [para('x', 24, '#ffffff')])],
    ]);
    expect(rules(d, 'contrast')).toEqual([]);
  });

  it('resolves unset text color to the theme text role', () => {
    const d = deck([[text('t', frame(200, 200, 600, 100), 'theme text')]], {}, '#111111');
    // default-light text is dark: dark on dark.
    expect(rules(d, 'contrast')).toHaveLength(1);
  });
});

describe('overlap', () => {
  it('flags text colliding with text', () => {
    const d = deck([
      [text('a', frame(100, 100, 400, 60), 'First line'), text('b', frame(120, 110, 400, 60), 'Second line')],
    ]);
    expect(rules(d, 'overlap')).toEqual([
      expect.objectContaining({ rule: 'overlap', elementId: 'b' }),
    ]);
  });

  it('measures text by its ink: wide centered frames whose lines never meet do not overlap', () => {
    const d = deck([
      [
        text('a', frame(100, 100, 1200, 60), 'Left', { align: 'center' }),
        text('b', frame(800, 120, 1200, 60), 'Right', { align: 'center' }),
      ],
    ]);
    expect(rules(d, 'overlap')).toEqual([]);
  });

  it('catches text that runs out of its frame into the next element', () => {
    const long = Array.from({ length: 8 }, () => 'word').join(' ');
    const d = deck([
      [
        text('a', frame(100, 100, 200, 40), [para(long)], { autofit: 'none' }),
        text('b', frame(100, 200, 400, 40), 'Below'),
      ],
    ]);
    expect(rules(d, 'overlap')).toHaveLength(1);
  });

  it('ignores an empty, unfilled text box', () => {
    const d = deck([[text('e', frame(100, 100, 400, 100), ''), text('t', frame(100, 100, 400, 60), 'Hi')]]);
    expect(rules(d, 'overlap')).toEqual([]);
  });

  it('treats a text-less shape that encloses the text as a container', () => {
    const d = deck([
      [rect('card', frame(100, 100, 600, 300), { kind: 'srgb', value: '#eeeeee' }), text('t', frame(150, 150, 400, 60), 'Card')],
    ]);
    expect(rules(d, 'overlap')).toEqual([]);
  });

  it('counts an image only when the text sits on the picture', () => {
    const beside = deck([[image('i', frame(100, 100, 400, 300)), text('t', frame(100, 380, 400, 60), 'Caption')]]);
    const on = deck([[image('i', frame(100, 100, 400, 300)), text('t', frame(150, 200, 300, 60), 'On it')]]);
    expect(rules(beside, 'overlap')).toEqual([]);
    expect(rules(on, 'overlap')).toHaveLength(1);
  });

  it('checks group children at their world position', () => {
    const group = {
      id: 'g',
      type: 'group',
      frame: frame(100, 100, 400, 120),
      data: {
        children: [
          text('n', frame(0, 0, 100, 90), [para('01', 48)]),
          text('l', frame(30, 37, 370, 80), 'Label'),
        ],
      },
    } as unknown as Element;
    expect(rules(deck([[group]]), 'overlap')).toEqual([
      expect.objectContaining({ elementId: 'l' }),
    ]);
  });
});

describe('out-of-bounds', () => {
  it('flags text past the slide edge', () => {
    const d = deck([[text('t', frame(1700, 100, 400, 60), 'Clipped on the right side')]]);
    expect(rules(d, 'out-of-bounds')[0].message).toMatch(/right edge/);
  });

  it('allows a frame hanging off the slide when its centered text stays on it', () => {
    const d = deck([[text('t', frame(-80, 100, 1000, 60), 'Centered', { align: 'center' })]]);
    expect(rules(d, 'out-of-bounds')).toEqual([]);
  });

  it('ignores bleeding decoration and reports parked shapes as info', () => {
    const d = deck([[rect('bleed', frame(1800, 900, 400, 400), { kind: 'srgb', value: '#f00' }), rect('parked', frame(2000, 0, 100, 100), { kind: 'srgb', value: '#f00' })]]);
    expect(rules(d, 'out-of-bounds')).toEqual([
      expect.objectContaining({ elementId: 'parked', severity: 'info' }),
    ]);
  });
});

describe('edge-margin', () => {
  it('flags text inside the 0.5in margin, measured on the ink', () => {
    const d = deck([[text('t', frame(20, 300, 600, 60), 'Too close')]]);
    expect(rules(d, 'edge-margin')[0].message).toMatch(/0\.14in from the left edge/);
  });

  it('exempts footer-like text in the bottom band', () => {
    const d = deck([[text('f', frame(20, 1030, 400, 40), [para('Page 3', 12)])]]);
    expect(rules(d, 'edge-margin')).toEqual([]);
  });
});

describe('min-font', () => {
  it('flags text that renders below 12 slide points', () => {
    // 12 stored pt × 96/72 = 16 px = 8 slide pt.
    const d = deck([[text('t', frame(200, 200, 600, 60), [para('tiny', 12)])]]);
    expect(rules(d, 'min-font')[0]).toMatchObject({ severity: 'error' });
    expect(rules(d, 'min-font')[0].message).toMatch(/8pt \(min 12pt\)/);
  });

  it('applies the deck pxPerPt pre-scale: 12pt in a PPTX widescreen deck is 12pt', () => {
    const d = deck([[text('t', frame(200, 200, 600, 60), [para('ok', 12)])]], { pxPerPt: 2 });
    expect(rules(d, 'min-font')).toEqual([]);
  });

  it('holds footer-like text to the smaller footer minimum', () => {
    // 15 stored pt = 10 slide pt: too small for body, fine for a footer.
    const body = deck([[text('t', frame(200, 400, 600, 60), [para('body', 15)])]]);
    const footer = deck([[text('t', frame(200, 1020, 600, 40), [para('footer', 15)])]]);
    expect(rules(body, 'min-font')).toHaveLength(1);
    expect(rules(footer, 'min-font')).toEqual([]);
  });
});

describe('overflow', () => {
  const long = Array.from({ length: 30 }, () => 'word').join(' ');

  it('reports shrink text that cannot fit even at the minimum scale as an error', () => {
    const d = deck([[text('t', frame(100, 100, 100, 10), [para(long)], { autofit: 'shrink' })]]);
    expect(rules(d, 'overflow')[0]).toMatchObject({ severity: 'error' });
  });

  it('reports autofit-none text with whole lines outside its box', () => {
    const d = deck([[text('t', frame(100, 100, 300, 40), [para(long)], { autofit: 'none' })]]);
    expect(rules(d, 'overflow')[0].message).toMatch(/lines paint outside the box/);
  });

  it('accepts a one-line label whose box is only shorter than its line height', () => {
    const d = deck([[text('t', frame(100, 100, 400, 30), [para('32', 24)], { autofit: 'none' })]]);
    expect(rules(d, 'overflow')).toEqual([]);
  });

  it('reports text spilling past the edge of a filled chip, even by part of a line', () => {
    const chip = {
      id: 'chip',
      type: 'shape',
      frame: frame(100, 100, 300, 40),
      data: {
        kind: 'roundRect',
        fill: { kind: 'srgb', value: '#334155' },
        text: {
          blocks: [para('two lines of chip text here', 24)],
          autofit: 'none',
          inset: { left: 8, top: 2, right: 8, bottom: 2 },
        },
      },
    } as unknown as Element;
    expect(rules(deck([[chip]]), 'overflow')[0].message).toMatch(/spills .*past the edge/);
  });

  it('leaves grow text to grow', () => {
    const d = deck([[text('t', frame(100, 100, 300, 40), [para(long)])]]);
    expect(rules(d, 'overflow')).toEqual([]);
  });
});

describe('token-wrap', () => {
  // 24pt → 32px, so every character is 16px wide with the test measurer.
  it('flags a bracketed group split across lines', () => {
    const d = deck([[text('t', frame(200, 200, 260, 200), 'Hit rate (58 / 174)')]]);
    const [f] = rules(d, 'token-wrap');
    expect(f).toMatchObject({ rule: 'token-wrap', severity: 'warning', elementId: 't' });
    expect(f.message).toContain('"(58 / 174)" into "(58 /" / "174)"');
  });

  it('flags a number broken mid-word', () => {
    const d = deck([[text('t', frame(200, 200, 100, 300), 'Revenue 1,234,567,890')]]);
    expect(rules(d, 'token-wrap')[0].message).toMatch(/splits "1,234,567,890"/);
  });

  it('flags a number split from its unit at a style change', () => {
    const b = para('Signed 87', 24);
    b.inlines.push({ text: '건 total', style: { fontSize: 24, bold: true } });
    // "Signed 87" is 9 chars = 144px: the "건" segment no longer fits.
    const d = deck([[text('t', frame(200, 200, 150, 300), [b])]]);
    expect(rules(d, 'token-wrap')[0].message).toMatch(/splits "87건"/);
  });

  it('leaves ordinary word wraps, long asides and explicit breaks alone', () => {
    const words = deck([[text('t', frame(200, 200, 200, 300), 'Revenue grew steadily this year')]]);
    const aside = deck([
      [text('t', frame(200, 200, 400, 300), 'Revenue (which includes every regional channel)')],
    ]);
    const explicit = deck([[text('t', frame(200, 200, 600, 300), 'Hit rate (58 /\n174)')]]);
    const fits = deck([[text('t', frame(200, 200, 400, 100), 'Hit rate (58 / 174)')]]);
    expect(rules(words, 'token-wrap')).toEqual([]);
    expect(rules(aside, 'token-wrap')).toEqual([]);
    expect(rules(explicit, 'token-wrap')).toEqual([]);
    expect(rules(fits, 'token-wrap')).toEqual([]);
  });
});

describe('empty-region', () => {
  const top = (n: number, y0 = 100) =>
    Array.from({ length: n }, (_, i) => text(`t${i}`, frame(200, y0 + i * 80, 800, 60), `Row ${i}`));

  it('warns when content stops in the top third of the safe area', () => {
    const [f] = rules(deck([top(3)]), 'empty-region');
    expect(f).toMatchObject({ rule: 'empty-region', severity: 'warning', slideId: 's1' });
    expect(f.message).toMatch(/bottom \d+% of the safe area is empty/);
  });

  it('reports a moderately empty bottom band as info', () => {
    const f = rules(deck([top(4, 160)]), 'empty-region');
    expect(f).toEqual([expect.objectContaining({ severity: 'info' })]);
  });

  it('accepts content that reaches down the slide', () => {
    const d = deck([[...top(3), image('i', frame(200, 500, 800, 380))]]);
    expect(rules(d, 'empty-region')).toEqual([]);
  });

  it('skips sparse slides: covers, section layouts, fewer than three elements', () => {
    const two = deck([top(2)]);
    const cover = deck([top(3)]);
    cover.slides[0].layoutId = 'title-slide';
    expect(rules(two, 'empty-region')).toEqual([]);
    expect(rules(cover, 'empty-region')).toEqual([]);
  });

  it('does not count footers, backgrounds or full-height decoration as content', () => {
    const d = deck([
      [
        rect('bg', frame(0, 0, 1920, 1080), { kind: 'srgb', value: '#f5f5f5' }),
        rect('side', frame(1700, 0, 220, 1080), { kind: 'srgb', value: '#334155' }),
        ...top(3),
        text('foot', frame(200, 1020, 400, 40), [para('Page 3', 14)]),
      ],
    ]);
    expect(rules(d, 'empty-region')).toEqual([
      expect.objectContaining({ severity: 'warning' }),
    ]);
  });
});

describe('inset-inconsistent', () => {
  const fill = { kind: 'srgb', value: '#eeeeee' } as Fill;
  const card = (i: number, inset: number, size = { w: 400, h: 300 }) => {
    const x = 100 + i * 500;
    return [
      rect(`card${i}`, frame(x, 300, size.w, size.h), fill),
      text(`label${i}`, frame(x + 30, 300 + inset, size.w - 60, 60), `Card ${i}`),
    ];
  };

  it('flags the card whose text sits against its border while siblings are padded', () => {
    const d = deck([[...card(0, 30), ...card(1, 0), ...card(2, 30)]]);
    const f = rules(d, 'inset-inconsistent');
    expect(f).toEqual([expect.objectContaining({ elementId: 'card1', severity: 'info' })]);
    expect(f[0].message).toMatch(/top inset .* vs .* in its sibling cards/);
  });

  it('reports the cramped card of a pair', () => {
    const f = rules(deck([[...card(0, 30), ...card(1, 2)]]), 'inset-inconsistent');
    expect(f.map((x) => x.elementId)).toEqual(['card1']);
  });

  it('accepts consistent padding and differences within the tolerance', () => {
    expect(rules(deck([[...card(0, 30), ...card(1, 30), ...card(2, 24)]]), 'inset-inconsistent')).toEqual([]);
  });

  it('only compares cards of similar size', () => {
    const d = deck([[...card(0, 30), ...card(1, 0, { w: 200, h: 120 })]]);
    expect(rules(d, 'inset-inconsistent')).toEqual([]);
  });

  it('measures a card with its own text by its inset, but not middle-anchored text', () => {
    const own = (id: string, x: number, top: number, anchor?: 'middle') =>
      ({
        id,
        type: 'shape',
        frame: frame(x, 300, 400, 300),
        data: {
          kind: 'rect',
          fill,
          text: {
            blocks: [para(`Card ${id}`)],
            verticalAnchor: anchor ?? 'top',
            inset: { left: 24, top, right: 24, bottom: 24 },
          },
        },
      }) as unknown as Element;
    const top = deck([[own('a', 100, 24), own('b', 600, 2), own('c', 1100, 24)]]);
    expect(rules(top, 'inset-inconsistent').map((f) => f.elementId)).toEqual(['b']);
    const mid = deck([[own('a', 100, 24, 'middle'), own('b', 600, 2, 'middle'), own('c', 1100, 24, 'middle')]]);
    expect(rules(mid, 'inset-inconsistent')).toEqual([]);
  });
});

describe('applyAllowlist', () => {
  const d = deck([[text('a', frame(200, 200, 600, 100), [para('01', 24, '#fdc433')]), text('b', frame(200, 400, 600, 100), [para('02', 24, '#fdc433')])]]);
  const findings = rules(d, 'contrast');

  it('matches by element id, by text prefix, or any element on the slide', () => {
    expect(applyAllowlist(findings, [{ rule: 'contrast', slideId: 's1', elementId: 'a', reason: 'accent' }]).open).toHaveLength(1);
    expect(applyAllowlist(findings, [{ rule: 'contrast', slideId: 's1', text: '02', reason: 'accent' }]).open.map((f) => f.elementId)).toEqual(['a']);
    expect(applyAllowlist(findings, [{ rule: 'contrast', slideId: 's1', reason: 'accent' }]).open).toEqual([]);
  });

  it('reports entries that matched nothing', () => {
    const { unused } = applyAllowlist(findings, [{ rule: 'overlap', slideId: 's1', reason: 'stale' }]);
    expect(unused).toHaveLength(1);
  });
});

describe('color', () => {
  it('computes the WCAG contrast ratio', () => {
    expect(contrastRatio(parseCssColor('#000')!, parseCssColor('#fff')!)).toBeCloseTo(21);
    expect(parseCssColor('rgba(255, 0, 0, 0.5)')).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });
  });
});

describe('renderer parity (review fixes)', () => {
  const group = (f: ReturnType<typeof frame>, children: Element[], extra: object = {}) =>
    ({ id: 'g', type: 'group', frame: f, data: { children, ...extra } }) as unknown as Element;

  it('lays shape text inside the preset text rectangle (ellipse)', () => {
    // An ellipse's preset text rect is ~0.15 in from each side, so the same
    // text wraps into more lines than in a rect of the same frame.
    const shape = (kind: string) =>
      ({
        id: kind,
        type: 'shape',
        frame: frame(100, 100, 300, 300),
        data: { kind, text: { blocks: [para('aaaa bbbb cccc dddd eeee ffff ggg')] } },
      }) as unknown as Element;
    const lines = (kind: string) =>
      layoutReport(deck([[shape(kind)]]), { measurer })[0].elements[0].text!.lines;
    expect(lines('rect')).toBe(3);
    expect(lines('ellipse')).toBe(4);
  });

  it('falls back to the bounding box for a child of a rotated group', () => {
    const g = { ...group(frame(600, 400, 400, 100), [text('t', frame(0, 0, 400, 100), 'Hi')]) };
    (g as { frame: { rotation: number } }).frame.rotation = Math.PI / 2;
    const [slide] = layoutReport(deck([[g]]), { measurer });
    const child = slide.elements.find((e) => e.elementId === 't')!;
    expect(child.box.w).toBeCloseTo(100, 0);
    expect(rules(deck([[g]]), 'edge-margin')).toEqual([]);
  });

  it('sizes text in a scaled group by its painted size', () => {
    // refSize 800×200 shown at 200×50: 30pt text paints at a quarter size.
    const g = group(frame(200, 200, 200, 50), [text('t', frame(0, 0, 800, 200), [para('small', 30)])], {
      refSize: { w: 800, h: 200 },
    });
    expect(rules(deck([[g]]), 'min-font')).toEqual([
      expect.objectContaining({ elementId: 't', severity: 'error' }),
    ]);
  });

  it('judges a highlighted run against its highlight', () => {
    const b = para('chip', 24, '#ffffff');
    b.inlines[0].style.backgroundColor = '#111111';
    expect(rules(deck([[text('t', frame(200, 200, 600, 100), [b])]]), 'contrast')).toEqual([]);
  });

  it('does not crash on a slide without a background', () => {
    const d = deck([[text('t', frame(200, 200, 600, 100), 'x')]]);
    delete (d.slides[0] as { background?: unknown }).background;
    expect(() => lint(d)).not.toThrow();
  });

  it('matches allowlist text longer than the 40-character finding text', () => {
    const long = 'A subtitle that is much longer than forty characters in total';
    const d = deck([[text('t', frame(200, 200, 1500, 100), [para(long, 24, '#cccccc')])]]);
    const f = rules(d, 'contrast');
    expect(applyAllowlist(f, [{ rule: 'contrast', slideId: 's1', text: long, reason: 'x' }]).open).toEqual([]);
  });
});
