import { SLIDE_WIDTH } from '@wafflebase/slides';
import { themedDeck, type Decor } from './builders';
import type { SlidesSlide, SlidesTextElement } from '../../yorkie/yorkie.types';

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

const shapes = (s: SlidesSlide) => s.elements.filter((e) => e.type === 'shape');

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
