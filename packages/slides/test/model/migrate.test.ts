import { describe, it, expect } from 'vitest';
import { migrateDocument } from '../../src/model/migrate';

describe('migrateDocument', () => {
  it('adds default themeId/masterId/themes/masters/layouts to legacy doc', () => {
    const legacy = {
      meta: { title: 'Old' },
      slides: [],
      layouts: [{ id: 'blank', name: 'Blank', placeholders: [] }],
    } as any;
    const out = migrateDocument(legacy);
    expect(out.meta.themeId).toBe('default-light');
    expect(out.meta.masterId).toBe('default');
    expect(out.themes.find((t) => t.id === 'default-light')).toBeDefined();
    expect(out.masters.find((m) => m.id === 'default')).toBeDefined();
    expect(out.layouts.find((l) => l.id === 'blank')).toBeDefined();
  });

  it('remaps legacy layoutId "title" to "title-slide"', () => {
    const legacy = {
      meta: { title: 'Old' },
      slides: [
        {
          id: 's1',
          layoutId: 'title',
          background: { fill: '#ffffff' },
          elements: [],
          notes: [],
        },
      ],
      layouts: [],
    } as any;
    const out = migrateDocument(legacy);
    expect(out.slides[0].layoutId).toBe('title-slide');
  });

  it('wraps a legacy string background fill into srgb ThemeColor', () => {
    const legacy = {
      meta: { title: 'Old' },
      slides: [
        {
          id: 's1',
          layoutId: 'blank',
          background: { fill: '#ffaa00' },
          elements: [],
          notes: [],
        },
      ],
      layouts: [],
    } as any;
    const out = migrateDocument(legacy);
    expect(out.slides[0].background.fill).toEqual({ kind: 'srgb', value: '#ffaa00' });
  });

  it('wraps a legacy shape fill string into srgb ThemeColor', () => {
    const legacy = {
      meta: { title: 'Old' },
      slides: [
        {
          id: 's1',
          layoutId: 'blank',
          background: { fill: '#fff' },
          elements: [
            {
              id: 'e1',
              type: 'shape',
              frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
              data: { kind: 'rect', fill: '#abcdef' },
            },
          ],
          notes: [],
        },
      ],
      layouts: [],
    } as any;
    const out = migrateDocument(legacy);
    const shape = out.slides[0].elements[0] as any;
    expect(shape.data.fill).toEqual({ kind: 'srgb', value: '#abcdef' });
  });

  it('is idempotent — running twice produces the same result', () => {
    const legacy = {
      meta: { title: 'Old' },
      slides: [],
      layouts: [],
    } as any;
    const once = migrateDocument(legacy);
    const twice = migrateDocument(once);
    expect(twice).toEqual(once);
  });
});
