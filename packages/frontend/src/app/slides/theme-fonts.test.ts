import { describe, it, expect } from 'vitest';
import { BUILT_IN_THEMES } from '@wafflebase/slides';
import { FONT_CATALOG_DATA } from '../../components/text-formatting/font-catalog.data';

describe('theme fonts are in the catalog', () => {
  const families = new Set(FONT_CATALOG_DATA.map((f) => f.family));

  it('every theme heading and body font exists in the font catalog', () => {
    for (const t of BUILT_IN_THEMES) {
      expect(families.has(t.fonts.heading), `${t.id} heading "${t.fonts.heading}"`).toBe(true);
      expect(families.has(t.fonts.body), `${t.id} body "${t.fonts.body}"`).toBe(true);
    }
  });
});
