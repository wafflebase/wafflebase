import { DEFAULT_BLOCK_STYLE, type Block } from '@wafflebase/docs';
import type { Layout, PlaceholderSpec } from './presentation';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from './presentation';

const PADDING = 80;

function emptyBlocks(): Block[] {
  return [
    {
      id: 'placeholder',
      type: 'paragraph',
      inlines: [{ text: '', style: {} }],
      // Fully-defaulted style — see `text-renderer.ts:drawText` for why
      // sparse styles cannot reach `computeLayout` (NaN'd cumulative y).
      style: { ...DEFAULT_BLOCK_STYLE },
    } as Block,
  ];
}

function textPlaceholder(
  x: number, y: number, w: number, h: number,
): PlaceholderSpec {
  return {
    type: 'text',
    frame: { x, y, w, h, rotation: 0 },
    data: { blocks: emptyBlocks() },
  };
}

/** Built-in layouts — order is the order they appear in the toolbar.
 *
 * `masterId: 'default'` and `staticElements: []` are throwaway scaffolding
 * to satisfy the `Layout` type widened in the previous commit. Task 7
 * replaces this file with the eleven-layout set and proper master
 * bindings.
 */
export const BUILT_IN_LAYOUTS: Layout[] = [
  {
    id: 'blank',
    masterId: 'default',
    name: 'Blank',
    placeholders: [],
    staticElements: [],
  },
  {
    id: 'title',
    masterId: 'default',
    name: 'Title',
    placeholders: [
      textPlaceholder(
        PADDING,
        SLIDE_HEIGHT / 2 - 120,
        SLIDE_WIDTH - PADDING * 2,
        160,
      ),
      textPlaceholder(
        PADDING,
        SLIDE_HEIGHT / 2 + 60,
        SLIDE_WIDTH - PADDING * 2,
        80,
      ),
    ],
    staticElements: [],
  },
  {
    id: 'title-body',
    masterId: 'default',
    name: 'Title + body',
    placeholders: [
      textPlaceholder(PADDING, PADDING, SLIDE_WIDTH - PADDING * 2, 140),
      textPlaceholder(
        PADDING,
        PADDING + 180,
        SLIDE_WIDTH - PADDING * 2,
        SLIDE_HEIGHT - PADDING * 2 - 200,
      ),
    ],
    staticElements: [],
  },
];

/** Look up a built-in layout by id, defaulting to 'blank'. */
export function getLayout(layoutId: string): Layout {
  return BUILT_IN_LAYOUTS.find((l) => l.id === layoutId) ?? BUILT_IN_LAYOUTS[0];
}
