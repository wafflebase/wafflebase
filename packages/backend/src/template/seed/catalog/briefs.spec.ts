import { TEMPLATE_BRIEFS, getTemplateBrief } from './briefs';
import { TEMPLATE_CATALOG } from './index';
import type { SlidesDocument } from '../../../yorkie/yorkie.types';

const slideSlugs = new Set(
  TEMPLATE_CATALOG.filter((t) => t.content.kind === 'slides').map(
    (t) => t.slug,
  ),
);

describe('template briefs', () => {
  it('every brief maps to an existing slides template', () => {
    for (const b of TEMPLATE_BRIEFS) {
      expect(slideSlugs.has(b.slug)).toBe(true);
    }
  });

  it('brief slugs are unique', () => {
    const slugs = TEMPLATE_BRIEFS.map((b) => b.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('every brief has fields with unique keys', () => {
    for (const b of TEMPLATE_BRIEFS) {
      expect(b.fields.length).toBeGreaterThan(0);
      const keys = b.fields.map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('list / pairs fields declare a row range, and pairs name both columns', () => {
    for (const b of TEMPLATE_BRIEFS) {
      for (const f of b.fields) {
        if (f.type === 'list' || f.type === 'pairs') {
          expect(typeof f.min).toBe('number');
          expect(typeof f.max).toBe('number');
          expect((f.min as number) <= (f.max as number)).toBe(true);
        }
        if (f.type === 'pairs') {
          expect(f.pair?.length).toBe(2);
        }
      }
    }
  });

  // A brief's row range is a promise about the slide it fills: asking a user
  // for five key results the slide has four rows for means one is dropped. The
  // slide a field fills is found by its label — a slide title, or a column
  // header on a two-column slide — so this also fails when a label drifts away
  // from the slide it describes.
  it('list / pairs max never exceeds the rows the template slide provides', () => {
    const norm = (s: string) =>
      s
        .split(/ \(| — /)[0]
        .trim()
        .toLowerCase();
    for (const b of TEMPLATE_BRIEFS) {
      const seed = TEMPLATE_CATALOG.find((t) => t.slug === b.slug)!;
      const doc = (seed.content as { document: SlidesDocument }).document;
      // Per slide: each placeholder's lines, in slot order.
      const slides = doc.slides.map((s) =>
        s.elements
          .filter((e) => e.type === 'text' && e.placeholderRef)
          .map((e) =>
            (e.type === 'text' ? e.data.blocks : []).map((bl) =>
              bl.inlines
                .map((i) => i.text)
                .join('')
                .toLowerCase(),
            ),
          ),
      );
      for (const f of b.fields) {
        if (f.type !== 'list' && f.type !== 'pairs') continue;
        const label = norm(f.label);
        let capacity: number | undefined;
        const byTitle = slides.find((ph) => ph[0]?.[0]?.startsWith(label));
        if (byTitle) {
          const cols = byTitle.slice(1);
          // Two columns are a header row plus data rows; one body is all rows.
          capacity =
            cols.length >= 2
              ? Math.min(...cols.map((c) => c.length - 1))
              : cols[0]?.length;
        } else {
          for (const ph of slides) {
            const col = ph.slice(1).find((c) => c[0]?.startsWith(label));
            if (col) capacity = col.length - 1;
          }
        }
        expect({
          brief: b.slug,
          field: f.key,
          found: capacity !== undefined,
        }).toEqual({ brief: b.slug, field: f.key, found: true });
        expect({ brief: b.slug, field: f.key, max: f.max }).toEqual({
          brief: b.slug,
          field: f.key,
          max: Math.min(f.max as number, capacity as number),
        });
      }
    }
  });

  it('getTemplateBrief resolves by slug', () => {
    expect(getTemplateBrief('sprint-retrospective')?.slug).toBe(
      'sprint-retrospective',
    );
    expect(getTemplateBrief('does-not-exist')).toBeUndefined();
  });
});
