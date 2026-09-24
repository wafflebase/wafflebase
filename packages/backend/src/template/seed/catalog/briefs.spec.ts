import type { FieldSpec } from './brief';
import { TEMPLATE_BRIEFS, getTemplateBrief } from './briefs';
import { TEMPLATE_CATALOG } from './index';

const slideSlugs = new Set(
  TEMPLATE_CATALOG.filter((t) => t.content.kind === 'slides').map((t) => t.slug),
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
      for (const f of b.fields as FieldSpec[]) {
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

  it('getTemplateBrief resolves by slug', () => {
    expect(getTemplateBrief('sprint-retrospective')?.slug).toBe(
      'sprint-retrospective',
    );
    expect(getTemplateBrief('does-not-exist')).toBeUndefined();
  });
});
