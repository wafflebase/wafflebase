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
