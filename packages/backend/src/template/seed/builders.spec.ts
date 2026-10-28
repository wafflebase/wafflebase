import {
  PATH_BUILDERS,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  defaultLight,
  type Fill,
} from '@wafflebase/slides';
import { themedDeck, type Decor } from './builders';
import { TEMPLATE_CATALOG } from './catalog';
import type {
  SlidesShapeElement,
  SlidesSlide,
  SlidesTextElement,
} from '../../yorkie/yorkie.types';

/**
 * `themedDeck` and the `Decor` presets it applies. `catalog.spec.ts` proves
 * every seeded deck passes the content validators, which holds whether or not
 * the text landed, the recolour ran or the frames moved — so those are
 * asserted here directly.
 */

const placeholders = (s: SlidesSlide): SlidesTextElement[] =>
  s.elements.filter(
    (e): e is SlidesTextElement => e.type === 'text' && !!e.placeholderRef,
  );

const shapes = (s: SlidesSlide): SlidesShapeElement[] =>
  s.elements.filter((e): e is SlidesShapeElement => e.type === 'shape');

const ALL_DECORS: Decor[] = [
  'plain',
  'block',
  'gradient',
  'header',
  'band',
  'geo',
  'dots',
  'diagonal',
  'sidebar',
  'split',
];

const COLOR_ROLES = Object.keys(defaultLight.colors);

/** Every theme role a fill references, gradient stops included. */
const fillRoles = (fill: Fill | undefined): string[] => {
  if (!fill) return [];
  if (fill.kind === 'gradient') {
    return fill.stops.flatMap((st) =>
      st.color.kind === 'role' ? [st.color.role] : [],
    );
  }
  return fill.kind === 'role' ? [fill.role] : [];
};

/**
 * The payload checks the type system cannot make: the content validators
 * accept any shape `kind` and `fill`, and a typo would paint nothing.
 */
const expectRenderable = (s: SlidesSlide): void => {
  for (const e of shapes(s)) {
    expect(PATH_BUILDERS.has(e.data.kind)).toBe(true);
    expect(e.data.fill).toBeDefined();
    const roles = fillRoles(e.data.fill);
    expect(roles.length).toBeGreaterThan(0);
    for (const r of roles) expect(COLOR_ROLES).toContain(r);
  }
  for (const r of fillRoles(s.background.fill)) {
    expect(COLOR_ROLES).toContain(r);
  }
};

const coversSlide = (e: SlidesShapeElement): boolean =>
  e.frame.x <= 0 &&
  e.frame.y <= 0 &&
  e.frame.x + e.frame.w >= SLIDE_WIDTH &&
  e.frame.y + e.frame.h >= SLIDE_HEIGHT;

const inlineColors = (t: SlidesTextElement): unknown[] =>
  t.data.blocks.flatMap((b) =>
    b.inlines.map((i) => (i.style as Record<string, unknown>)?.color),
  );

const one = (
  layoutId: string,
  texts: string[][],
  decor?: Decor,
): SlidesSlide => {
  const spec = decor
    ? ([layoutId, texts, decor] as [string, string[][], Decor])
    : ([layoutId, texts] as [string, string[][]]);
  return themedDeck('slate', 'Test', [spec]).slides[0];
};

describe('themedDeck', () => {
  it('embeds the chosen theme and points meta at it', () => {
    const doc = themedDeck('slate', 'Deck', [['title-slide', [['T']]]]);
    expect(doc.meta.themeId).toBe('slate');
    expect(doc.themes.map((t) => t.id)).toEqual(['slate']);
  });

  it('rejects an unknown built-in theme id instead of falling back', () => {
    expect(() => themedDeck('no-such-theme', 'Deck', [])).toThrow(
      /Unknown built-in theme id/,
    );
  });

  it('rejects an unknown layout id', () => {
    expect(() => themedDeck('slate', 'Deck', [['no-such-layout', []]])).toThrow(
      /Unknown layout/,
    );
  });

  it('writes each text entry into its placeholder, one block per line', () => {
    const s = one('title-body', [['Heading'], ['first', 'second']]);
    const [title, body] = placeholders(s);
    expect(title.data.blocks.map((b) => b.inlines[0].text)).toEqual([
      'Heading',
    ]);
    expect(body.data.blocks.map((b) => b.inlines[0].text)).toEqual([
      'first',
      'second',
    ]);
  });

  it('throws on more text entries than the layout has placeholders', () => {
    expect(() =>
      one('title-slide', [['Title'], ['Subtitle'], ['nowhere to go']]),
    ).toThrow(/has 2 placeholders, got 3/);
  });
});

describe('decorate presets', () => {
  it('paints decor under the text, never over it', () => {
    const s = one('title-body', [['T'], ['b']], 'geo');
    const firstText = s.elements.findIndex((e) => e.type === 'text');
    const lastShape = s.elements.map((e) => e.type).lastIndexOf('shape');
    expect(shapes(s).length).toBeGreaterThan(0);
    expect(lastShape).toBeLessThan(firstText);
  });

  it.each(ALL_DECORS)('%s emits shapes the renderer can paint', (decor) => {
    expectRenderable(one('title-body', [['T'], ['b']], decor));
  });

  it('every catalogue slides template paints only renderable shapes', () => {
    for (const seed of TEMPLATE_CATALOG) {
      if (seed.content.kind !== 'slides') continue;
      for (const s of seed.content.document.slides) expectRenderable(s);
    }
  });

  it('every catalogue slides template has its own background on some slide', () => {
    // A guard on the guard: the background fill check above only bites if
    // the catalogue actually exercises it.
    const withBg = TEMPLATE_CATALOG.flatMap((seed) =>
      seed.content.kind === 'slides'
        ? seed.content.document.slides.filter((s) => s.background.fill)
        : [],
    );
    expect(withBg.length).toBeGreaterThan(0);
  });

  it.each<[Decor, Fill['kind']]>([
    ['block', 'role'],
    ['gradient', 'gradient'],
  ])('%s colours the slide background, not a covering shape', (decor, kind) => {
    const s = one('title-slide', [['Title'], ['Subtitle']], decor);
    expect(s.background.fill?.kind).toBe(kind);
    expect(shapes(s).some(coversSlide)).toBe(false);
  });

  it.each(ALL_DECORS.filter((d) => d !== 'block' && d !== 'gradient'))(
    '%s leaves the background to inherit from the theme',
    (decor) => {
      const s = one('title-body', [['T'], ['b']], decor);
      expect(s.background.fill).toBeUndefined();
    },
  );

  it('rejects an unknown decor instead of silently painting nothing', () => {
    expect(() =>
      one('title-body', [['T'], ['b']], 'no-such-decor' as Decor),
    ).toThrow(/Unknown decor/);
  });

  it('gives an undecorated slide the plain base treatment', () => {
    const s = one('title-body', [['T'], ['b']]);
    const ids = shapes(s).map((e) => e.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/-spine$/);
    expect(ids[1]).toMatch(/-mark$/);
  });

  it.each<Decor>(['block', 'gradient'])(
    '%s recolours every placeholder to the background role',
    (decor) => {
      const s = one('title-slide', [['Title'], ['Subtitle']], decor);
      for (const t of placeholders(s)) {
        for (const c of inlineColors(t)) {
          expect(c).toEqual({ kind: 'role', role: 'background' });
        }
      }
    },
  );

  it.each<Decor>(['plain', 'geo', 'dots', 'band', 'diagonal', 'sidebar'])(
    '%s leaves text in its theme colour',
    (decor) => {
      const s = one('title-slide', [['Title'], ['Subtitle']], decor);
      for (const t of placeholders(s)) {
        for (const c of inlineColors(t)) {
          expect(c).not.toEqual({ kind: 'role', role: 'background' });
        }
      }
    },
  );

  it('header recolours only text that sits wholly inside the band', () => {
    const s = one('title-body', [['Title'], ['body line']], 'header');
    const band = shapes(s).find((e) => e.id.endsWith('-hd'))!;
    const bandBottom = band.frame.y + band.frame.h;
    for (const t of placeholders(s)) {
      const inside = t.frame.y + t.frame.h <= bandBottom;
      for (const c of inlineColors(t)) {
        if (inside) expect(c).toEqual({ kind: 'role', role: 'background' });
        else expect(c).not.toEqual({ kind: 'role', role: 'background' });
      }
    }
    // The body placeholder runs past the band, so it must keep its colour.
    expect(
      placeholders(s).some((t) => t.frame.y + t.frame.h > bandBottom),
    ).toBe(true);
  });

  it.each<[Decor, number]>([
    ['sidebar', 640],
    ['split', 960],
  ])('%s moves text off the %ipx colour column', (decor, column) => {
    const s = one('title-body', [['Title'], ['body']], decor);
    for (const t of placeholders(s)) {
      expect(t.frame.x).toBeGreaterThanOrEqual(column);
      expect(t.frame.x + t.frame.w).toBeLessThanOrEqual(SLIDE_WIDTH);
    }
  });

  it.each<Decor>(['sidebar', 'split'])(
    '%s keeps a two-column layout side by side',
    (decor) => {
      const plain = placeholders(
        one('title-two-columns', [['T'], ['left'], ['right']]),
      );
      const s = one('title-two-columns', [['T'], ['left'], ['right']], decor);
      const [, left, right] = placeholders(s);
      // Columns stay distinct and ordered, and do not overlap.
      expect(left.frame.x).toBeLessThan(right.frame.x);
      expect(left.frame.x + left.frame.w).toBeLessThanOrEqual(right.frame.x);
      // The gutter between them scales with the group rather than vanishing.
      const [, pl, pr] = plain;
      expect(pr.frame.x - (pl.frame.x + pl.frame.w)).toBeGreaterThan(0);
      expect(right.frame.x - (left.frame.x + left.frame.w)).toBeGreaterThan(0);
    },
  );
});
