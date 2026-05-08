import { DEFAULT_BLOCK_STYLE, type Block } from '@wafflebase/docs';
import type { PlaceholderType } from './element';
import type { Layout, PlaceholderSpec } from './presentation';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from './presentation';

const PADDING = 80;
const W = SLIDE_WIDTH - PADDING * 2;
const HALF = (W - PADDING) / 2;

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
  type: PlaceholderType,
  x: number, y: number, w: number, h: number,
): PlaceholderSpec {
  return {
    type: 'text',
    frame: { x, y, w, h, rotation: 0 },
    data: { blocks: emptyBlocks() },
    placeholder: { type },
  };
}

/** Built-in layouts — order is the order they appear in the toolbar.
 *
 * v1 layouts always carry `masterId: 'default'` and an empty
 * `staticElements` array (v1.5 populates static elements such as
 * decorative dividers, page numbers, and footer text). Geometry
 * mirrors Google Slides' eleven-layout default deck.
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
    id: 'title-slide',
    masterId: 'default',
    name: 'Title slide',
    placeholders: [
      textPlaceholder('title', PADDING, SLIDE_HEIGHT / 2 - 120, W, 160),
      textPlaceholder('subtitle', PADDING, SLIDE_HEIGHT / 2 + 60, W, 80),
    ],
    staticElements: [],
  },
  {
    id: 'section-header',
    masterId: 'default',
    name: 'Section header',
    placeholders: [
      textPlaceholder('title', PADDING, SLIDE_HEIGHT / 2 - 80, W, 200),
    ],
    staticElements: [],
  },
  {
    id: 'title-body',
    masterId: 'default',
    name: 'Title and body',
    placeholders: [
      textPlaceholder('title', PADDING, PADDING, W, 140),
      textPlaceholder(
        'body',
        PADDING,
        PADDING + 180,
        W,
        SLIDE_HEIGHT - PADDING * 2 - 200,
      ),
    ],
    staticElements: [],
  },
  {
    id: 'title-two-columns',
    masterId: 'default',
    name: 'Title and two columns',
    placeholders: [
      textPlaceholder('title', PADDING, PADDING, W, 140),
      textPlaceholder(
        'body',
        PADDING,
        PADDING + 180,
        HALF,
        SLIDE_HEIGHT - PADDING * 2 - 200,
      ),
      textPlaceholder(
        'body',
        PADDING + HALF + PADDING,
        PADDING + 180,
        HALF,
        SLIDE_HEIGHT - PADDING * 2 - 200,
      ),
    ],
    staticElements: [],
  },
  {
    id: 'title-only',
    masterId: 'default',
    name: 'Title only',
    placeholders: [
      textPlaceholder('title', PADDING, PADDING, W, 140),
    ],
    staticElements: [],
  },
  {
    id: 'one-column-text',
    masterId: 'default',
    name: 'One column text',
    placeholders: [
      textPlaceholder('body', PADDING, PADDING, W, SLIDE_HEIGHT - PADDING * 2),
    ],
    staticElements: [],
  },
  {
    id: 'main-point',
    masterId: 'default',
    name: 'Main point',
    placeholders: [
      textPlaceholder('title', PADDING, SLIDE_HEIGHT / 2 - 80, W, 160),
    ],
    staticElements: [],
  },
  {
    id: 'section-title-description',
    masterId: 'default',
    name: 'Section title and description',
    placeholders: [
      textPlaceholder('title', PADDING, PADDING * 2, W, 180),
      textPlaceholder(
        'body',
        PADDING,
        PADDING * 2 + 220,
        W,
        SLIDE_HEIGHT - PADDING * 4 - 240,
      ),
    ],
    staticElements: [],
  },
  {
    id: 'caption',
    masterId: 'default',
    name: 'Caption',
    placeholders: [
      textPlaceholder('body', PADDING, PADDING, W, SLIDE_HEIGHT - PADDING * 2 - 200),
      textPlaceholder('caption', PADDING, SLIDE_HEIGHT - PADDING - 160, W, 120),
    ],
    staticElements: [],
  },
  {
    id: 'big-number',
    masterId: 'default',
    name: 'Big number',
    placeholders: [
      textPlaceholder('big-number', PADDING, SLIDE_HEIGHT / 2 - 200, W, 280),
      textPlaceholder('body', PADDING, SLIDE_HEIGHT / 2 + 100, W, 100),
    ],
    staticElements: [],
  },
];

/** Look up a built-in layout by id, defaulting to 'blank'. */
export function getLayout(layoutId: string): Layout {
  return BUILT_IN_LAYOUTS.find((l) => l.id === layoutId) ?? BUILT_IN_LAYOUTS[0];
}
