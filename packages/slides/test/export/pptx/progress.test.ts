import { describe, it, expect } from 'vitest';
import { exportPptx } from '../../../src/export/pptx/index.js';
import type { Slide, SlidesDocument } from '../../../src/model/presentation.js';
import { DEFAULT_BACKGROUND } from '../../../src/model/presentation.js';
import { DEFAULT_MASTER } from '../../../src/model/master.js';
import { BUILT_IN_LAYOUTS } from '../../../src/model/layout.js';
import { BUILT_IN_THEMES } from '../../../src/themes/index.js';

const blankSlide = (id: string): Slide => ({
  id,
  layoutId: 'blank',
  background: { ...DEFAULT_BACKGROUND },
  elements: [],
  notes: [],
});

const deck = (slides: Slide[]): SlidesDocument => ({
  meta: { title: 'Deck', themeId: BUILT_IN_THEMES[0].id, masterId: 'default' },
  themes: [BUILT_IN_THEMES[0]],
  masters: [DEFAULT_MASTER],
  layouts: BUILT_IN_LAYOUTS,
  slides,
  guides: [],
});

describe('exportPptx progress', () => {
  it('reports monotonic per-slide progress ending at total', async () => {
    const calls: Array<[number, number, string]> = [];
    await exportPptx(deck([blankSlide('s1'), blankSlide('s2')]), {
      onProgress: (done, total, phase) => calls.push([done, total, phase]),
    });
    expect(calls[0]).toEqual([0, 2, 'slides']);
    expect(calls[calls.length - 1]).toEqual([2, 2, 'slides']);
    expect(calls.every((c) => c[1] === 2 && c[2] === 'slides')).toBe(true);
  });
});
