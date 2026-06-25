import { describe, it, expect } from 'vitest';
import {
  resolveBackgroundFill,
  resolveBackgroundImage,
} from '../../src/model/presentation';
import type { SlidesDocument, Slide } from '../../src/model/presentation';
import type { ThemeColor } from '../../src/model/theme';
import { DEFAULT_MASTER } from '../../src/model/master';
import { defaultLight } from '../../src/themes/default-light';

const ROLE_BG: ThemeColor = { kind: 'role', role: 'background' };

function doc(over: Partial<SlidesDocument> = {}): SlidesDocument {
  return {
    meta: { title: 't', themeId: 'default-light', masterId: 'default' },
    themes: [defaultLight],
    masters: [structuredClone(DEFAULT_MASTER)],
    layouts: [
      { id: 'L', masterId: 'default', name: 'L', placeholders: [], staticElements: [] },
    ],
    slides: [],
    guides: [],
    ...over,
  };
}

function slide(bg: Slide['background']): Slide {
  return { id: 's', layoutId: 'L', background: bg, elements: [], notes: [] };
}

describe('resolveBackgroundFill — precedence slide → layout → master → role', () => {
  it('uses the slide fill when set (explicit override wins)', () => {
    const d = doc();
    const s = slide({ fill: { kind: 'srgb', value: '#111111' } });
    expect(resolveBackgroundFill(s, d)).toEqual({ kind: 'srgb', value: '#111111' });
  });

  it('falls back to the layout fill when the slide has none', () => {
    const d = doc({
      layouts: [
        {
          id: 'L',
          masterId: 'default',
          name: 'L',
          placeholders: [],
          staticElements: [],
          background: { fill: { kind: 'srgb', value: '#222222' } },
        },
      ],
    });
    expect(resolveBackgroundFill(slide({}), d)).toEqual({
      kind: 'srgb',
      value: '#222222',
    });
  });

  it('falls back to the master fill when slide and layout have none', () => {
    const master = structuredClone(DEFAULT_MASTER);
    master.background.fill = { kind: 'srgb', value: '#333333' };
    const d = doc({ masters: [master] });
    expect(resolveBackgroundFill(slide({}), d)).toEqual({
      kind: 'srgb',
      value: '#333333',
    });
  });

  it('falls back to the background role when nothing sets a fill', () => {
    const master = structuredClone(DEFAULT_MASTER);
    // DEFAULT_MASTER already uses role background; assert the final fallback
    // independent of the master by clearing it.
    delete (master.background as { fill?: ThemeColor }).fill;
    const d = doc({ masters: [master] });
    expect(resolveBackgroundFill(slide({}), d)).toEqual(ROLE_BG);
  });
});

describe('resolveBackgroundImage — precedence slide → layout → master', () => {
  it('uses the slide image when set', () => {
    const d = doc();
    const s = slide({ image: { src: 'slide.png' } });
    expect(resolveBackgroundImage(s, d)?.src).toBe('slide.png');
  });

  it('falls back to the layout image, then master image', () => {
    const master = structuredClone(DEFAULT_MASTER);
    master.background.image = { src: 'master.png' };
    const withLayout = doc({
      masters: [master],
      layouts: [
        {
          id: 'L',
          masterId: 'default',
          name: 'L',
          placeholders: [],
          staticElements: [],
          background: { fill: ROLE_BG, image: { src: 'layout.png' } },
        },
      ],
    });
    expect(resolveBackgroundImage(slide({}), withLayout)?.src).toBe('layout.png');

    const masterOnly = doc({ masters: [master] });
    expect(resolveBackgroundImage(slide({}), masterOnly)?.src).toBe('master.png');
  });

  it('returns undefined when no level sets an image', () => {
    expect(resolveBackgroundImage(slide({}), doc())).toBeUndefined();
  });
});
