import { DEFAULT_BLOCK_STYLE } from '@wafflebase/docs';
import { STICKY_COLORS, STICKY_SIZE, buildStickyInit } from '@wafflebase/board';
import type { SlidesElement } from '../../../../yorkie/yorkie.types';
import type { TemplateSeed } from '../../types';

// --------------------------------------------------------------------------
// Board
// --------------------------------------------------------------------------

/*
 * The older board design: column headings over a stack of blank stickies,
 * no sections. The stickies come out of the board's own factory, so they
 * are the sticky a person makes (shadow, centred text, the board's sticky
 * controls) in the same palette as the section boards.
 */

/** Gutter between stickies in a column. */
const ROW_GAP = 24;
/**
 * Gutter between columns. With no section frames to separate them, the
 * columns are told apart by space alone, so it is wider than the row gap.
 */
const COLUMN_GAP = 96;
const COLUMN_STRIDE = STICKY_SIZE + COLUMN_GAP;
const HEADING_H = 48;
/** Heading to the first sticky. */
const HEADING_GAP = 24;
const STICKIES_Y = HEADING_H + HEADING_GAP;

/** A column heading, centred over its column of stickies. */
function columnHeading(index: number, text: string): SlidesElement {
  return {
    id: `head-${index}`,
    type: 'text',
    frame: {
      x: index * COLUMN_STRIDE - COLUMN_GAP / 2,
      y: 0,
      w: COLUMN_STRIDE,
      h: HEADING_H,
      rotation: 0,
    },
    data: {
      blocks: [
        {
          id: `head-${index}-p`,
          type: 'paragraph',
          style: { ...DEFAULT_BLOCK_STYLE, alignment: 'center' },
          inlines: [{ text, style: { bold: true, fontSize: 24 } }],
        },
      ],
    },
  } as SlidesElement;
}

/** A blank sticky note in `column`, `row`. */
function sticky(
  key: string,
  column: number,
  row: number,
  fill: string,
): SlidesElement {
  const init = buildStickyInit(
    fill,
    {
      x: column * COLUMN_STRIDE + STICKY_SIZE / 2,
      y: STICKIES_Y + row * (STICKY_SIZE + ROW_GAP) + STICKY_SIZE / 2,
    },
    { text: '', fontSize: 18 },
  );
  return { ...init, id: key } as unknown as SlidesElement;
}

const stickyFill = (name: string) =>
  STICKY_COLORS.find((c) => c.name === name)!.value;

const COLUMNS = [
  { title: 'Went well', fill: stickyFill('Green') },
  { title: 'Could improve', fill: stickyFill('Orange') },
  { title: 'Action items', fill: stickyFill('Blue') },
];

const retrospectiveBoard: TemplateSeed = {
  slug: 'retrospective-board',
  title: 'Retrospective Board',
  description:
    'Three columns and a stack of blank stickies, ready to drag. Went well, could improve, action items — double-click a sticky to type.',
  category: 'Project management',
  tags: ['retro', 'agile', 'workshop'],
  content: {
    kind: 'board',
    root: {
      meta: { title: 'Retrospective' },
      elements: [
        ...COLUMNS.map((c, i) => columnHeading(i, c.title)),
        ...COLUMNS.flatMap((c, i) =>
          [0, 1, 2].map((r) => sticky(`sticky-${i}-${r}`, i, r, c.fill)),
        ),
      ],
    },
  },
};

/** This file's templates, in gallery order — `../index.ts` concatenates them. */
export const seeds: TemplateSeed[] = [retrospectiveBoard];
