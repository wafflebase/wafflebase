import { describe, expect, it } from 'vitest';
import { migrateDocument } from './migrate';

describe('migrateBackground (via migrateDocument)', () => {
  it('migrates a gradient background fill, normalizing via migrateGradientFill', () => {
    // Deliberately omits `type` — mirrors a pre-radial-support stored
    // gradient (see migrateGradientFill's docstring). The un-fixed
    // `migrateBackground` routes every fill through `wrapColor`, which
    // passes an object carrying a `kind` straight through unnormalized
    // (no `type` backfill), so this assertion fails until
    // `migrateBackground` special-cases `kind === 'gradient'` the same
    // way `migrateElement` already does for shape fills.
    const raw = {
      slides: [
        {
          id: 's1',
          layoutId: 'l1',
          elements: [],
          notes: [],
          background: {
            fill: {
              kind: 'gradient',
              angle: 0,
              stops: [
                { pos: 0, color: { kind: 'srgb', value: '#fff' } },
                { pos: 1, color: { kind: 'srgb', value: '#000' } },
              ],
            },
          },
        },
      ],
    };
    const out = migrateDocument(raw as any);
    expect(out.slides[0].background.fill).toEqual({
      kind: 'gradient',
      type: 'linear',
      angle: 0,
      stops: [
        { pos: 0, color: { kind: 'srgb', value: '#fff' } },
        { pos: 1, color: { kind: 'srgb', value: '#000' } },
      ],
    });
  });

  it('migrates a plain solid ThemeColor fill unchanged', () => {
    const raw = {
      slides: [
        {
          id: 's1',
          layoutId: 'l1',
          elements: [],
          notes: [],
          background: { fill: { kind: 'srgb', value: '#123456' } },
        },
      ],
    };
    const out = migrateDocument(raw as any);
    expect(out.slides[0].background.fill).toEqual({
      kind: 'srgb',
      value: '#123456',
    });
  });

  it('wraps a legacy string fill into an srgb ThemeColor', () => {
    const raw = {
      slides: [
        {
          id: 's1',
          layoutId: 'l1',
          elements: [],
          notes: [],
          background: { fill: '#abcdef' },
        },
      ],
    };
    const out = migrateDocument(raw as any);
    expect(out.slides[0].background.fill).toEqual({
      kind: 'srgb',
      value: '#abcdef',
    });
  });

  it('leaves an absent fill undefined (inherit)', () => {
    const raw = {
      slides: [
        {
          id: 's1',
          layoutId: 'l1',
          elements: [],
          notes: [],
          background: {},
        },
      ],
    };
    const out = migrateDocument(raw as any);
    expect(out.slides[0].background.fill).toBeUndefined();
  });
});
