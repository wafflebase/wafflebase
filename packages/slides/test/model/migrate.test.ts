import { describe, it, expect } from 'vitest';
import { migrateDocument, migrateGradientFill } from '../../src/model/migrate';

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

  it("reconciles meta ids onto the deck's own themes/masters", () => {
    // A customized deck whose `meta` pins ids its arrays no longer carry.
    // `migrateMeta` alone answers 'default-light' / 'default', which
    // `getActiveTheme` refuses — the read path has to reconcile, because a
    // share-link viewer mount never runs the CRDT repair.
    const customized = {
      meta: { title: 'Deck', themeId: 'gone', masterId: 'gone' },
      slides: [],
      layouts: [],
      themes: [{ id: 'coral', name: 'Coral' }],
      masters: [{ id: 'custom', name: 'Custom', placeholders: [] }],
    } as any;
    const out = migrateDocument(customized);
    expect(out.meta.themeId).toBe('coral');
    expect(out.meta.masterId).toBe('custom');
  });

  it('does not reconcile onto a themes entry with no string id', () => {
    // `themes` / `masters` are read off the CRDT, where a collaborator can
    // write an entry carrying no `id`. Reconciling onto it would assign
    // `undefined` to a `string` field, and `getActiveTheme` would then match
    // `undefined === undefined` and resolve a theme with no palette — a
    // malformed deck rendering from nothing instead of reporting the id.
    const malformed = {
      meta: { title: 'Deck', themeId: 'gone', masterId: 'gone' },
      slides: [],
      layouts: [],
      themes: [{ name: 'No id' }, { id: 42 }],
      masters: [{ name: 'No id either' }],
    } as any;
    const out = migrateDocument(malformed);
    expect(out.meta.themeId).toBe('gone');
    expect(out.meta.masterId).toBe('gone');
    expect(typeof out.meta.themeId).toBe('string');
    expect(typeof out.meta.masterId).toBe('string');
  });

  it('reconciles onto the first entry that does carry a string id', () => {
    const partial = {
      meta: { title: 'Deck', themeId: 'gone', masterId: 'gone' },
      slides: [],
      layouts: [],
      themes: [{ name: 'No id' }, { id: 'coral', name: 'Coral' }],
      masters: [{ id: '' }, { id: 'custom', name: 'Custom' }],
    } as any;
    const out = migrateDocument(partial);
    expect(out.meta.themeId).toBe('coral');
    expect(out.meta.masterId).toBe('custom');
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

  it('does not resolve a layoutId off Object.prototype', () => {
    // `layoutId` comes from stored JSON (and from `PUT /content`, which
    // accepts any non-empty string), so an object-literal lookup would hand
    // back `Object` / `Object.prototype` / `toString` as the migrated id.
    const legacy = {
      meta: { title: 'Old' },
      slides: ['constructor', '__proto__', 'toString'].map((layoutId, i) => ({
        id: `s${i}`,
        layoutId,
        background: {},
        elements: [],
        notes: [],
      })),
      layouts: [],
    } as any;
    const out = migrateDocument(legacy);
    expect(out.slides.map((s) => s.layoutId)).toEqual([
      'constructor',
      '__proto__',
      'toString',
    ]);
  });

  it('falls back to "blank" for a missing or non-string layoutId', () => {
    const legacy = {
      meta: { title: 'Old' },
      slides: [
        { id: 's1', background: {}, elements: [], notes: [] },
        { id: 's2', layoutId: 42, background: {}, elements: [], notes: [] },
      ],
      layouts: [],
    } as any;
    const out = migrateDocument(legacy);
    expect(out.slides.map((s) => s.layoutId)).toEqual(['blank', 'blank']);
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

  it('preserves an absent background fill as inherit (no white default)', () => {
    const legacy = {
      meta: { title: 'New' },
      slides: [
        { id: 's1', layoutId: 'blank', background: {}, elements: [], notes: [] },
        { id: 's2', layoutId: 'blank', elements: [], notes: [] }, // no background
      ],
      layouts: [],
    } as any;
    const out = migrateDocument(legacy);
    // An inheriting slide keeps fill absent so it resolves through
    // slide → layout → master at render, rather than being pinned white.
    expect(out.slides[0].background.fill).toBeUndefined();
    expect(out.slides[1].background.fill).toBeUndefined();
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

  it('preserves `meta.pxPerPt` so the deck-DPI font scale survives reads', () => {
    const legacy = {
      meta: { title: 'Imported', pxPerPt: 2.6667 },
      slides: [],
      layouts: [],
    } as any;
    expect(migrateDocument(legacy).meta.pxPerPt).toBeCloseTo(2.6667, 4);
  });

  it('drops a non-finite or non-positive `meta.pxPerPt` (defensive)', () => {
    const bad = {
      meta: { title: 't', pxPerPt: 0 },
      slides: [],
      layouts: [],
    } as any;
    expect(migrateDocument(bad).meta.pxPerPt).toBeUndefined();
    const nanned = {
      meta: { title: 't', pxPerPt: NaN },
      slides: [],
      layouts: [],
    } as any;
    expect(migrateDocument(nanned).meta.pxPerPt).toBeUndefined();
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

  it('preserves recentColors, normalizing case/dupes/cap on read', () => {
    const doc = {
      meta: {
        title: 'Old',
        // mixed case + duplicate + non-string + 11 entries (over the cap)
        recentColors: [
          '#FF0000',
          '#ff0000',
          42,
          '#00ff00',
          '#0000ff',
          '#111111',
          '#222222',
          '#333333',
          '#444444',
          '#555555',
          '#666666',
        ],
      },
      slides: [],
      layouts: [],
    } as any;
    const out = migrateDocument(doc);
    expect(out.meta.recentColors).toEqual([
      '#ff0000',
      '#00ff00',
      '#0000ff',
      '#111111',
      '#222222',
      '#333333',
      '#444444',
      '#555555',
    ]);
  });

  it('omits recentColors when absent or empty', () => {
    expect(
      migrateDocument({ meta: { title: 'x' }, slides: [], layouts: [] } as any)
        .meta.recentColors,
    ).toBeUndefined();
    expect(
      migrateDocument({
        meta: { title: 'x', recentColors: [] },
        slides: [],
        layouts: [],
      } as any).meta.recentColors,
    ).toBeUndefined();
  });

  it('backfills type:"linear" on a legacy shape gradient fill with no type', () => {
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
              data: {
                kind: 'rect',
                fill: {
                  kind: 'gradient',
                  angle: Math.PI / 2,
                  stops: [
                    { pos: 0, color: { kind: 'srgb', value: '#fff' } },
                    { pos: 1, color: { kind: 'srgb', value: '#000' } },
                  ],
                },
              },
            },
          ],
          notes: [],
        },
      ],
      layouts: [],
    } as any;
    const out = migrateDocument(legacy);
    const shape = out.slides[0].elements[0] as any;
    expect(shape.data.fill.type).toBe('linear');
  });
});

describe('migrateGradientFill', () => {
  it('backfills type:"linear" on a legacy gradient with no type', () => {
    const legacy = {
      kind: 'gradient',
      angle: Math.PI / 2,
      stops: [
        { pos: 0, color: { kind: 'srgb', value: '#fff' } },
        { pos: 1, color: { kind: 'srgb', value: '#000' } },
      ],
    };
    expect(migrateGradientFill(legacy).type).toBe('linear');
  });

  it('preserves an explicit type', () => {
    const g = { kind: 'gradient', type: 'radial', angle: 0, stops: [] };
    expect(migrateGradientFill(g).type).toBe('radial');
  });
});
