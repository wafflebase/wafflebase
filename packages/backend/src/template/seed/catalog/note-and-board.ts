import { DEFAULT_BLOCK_STYLE } from '@wafflebase/docs';
import type { SlidesElement } from '../../../yorkie/yorkie.types';
import type { TemplateSeed } from '../types';

export const weeklyOneOnOne: TemplateSeed = {
  slug: 'weekly-one-on-one',
  title: 'Weekly 1:1',
  description:
    'A running markdown note for a recurring 1:1. Newest week on top, with the standing questions that make the meeting worth having.',
  category: 'Business',
  tags: ['1:1', 'manager', 'markdown'],
  content: {
    kind: 'note',
    document: {
      content: [
        '# Weekly 1:1 — <name>',
        '',
        'Newest entry on top. Anything unresolved moves down into **Carried over**.',
        '',
        '---',
        '',
        '## <date>',
        '',
        '### Their agenda',
        '',
        '- ',
        '',
        '### My agenda',
        '',
        '- ',
        '',
        '### Standing questions',
        '',
        '- What is slowing you down that I could remove?',
        '- What did you learn this week?',
        '- Is there feedback you have been sitting on?',
        '',
        '### Decisions',
        '',
        '- ',
        '',
        '### Actions',
        '',
        '- [ ] Action — owner — due',
        '',
        '---',
        '',
        '## Carried over',
        '',
        '- ',
        '',
        '## Notes for the next review cycle',
        '',
        '- Wins worth writing down while they are fresh',
        '- Growth areas, with a concrete example',
        '',
      ].join('\n'),
    },
  },
};

// --------------------------------------------------------------------------
// Board
// --------------------------------------------------------------------------

const STICKY_W = 260;
const STICKY_H = 200;
const COLUMN_X = [180, 620, 1060];

/** A column heading on the board canvas. */
function columnHeading(index: number, text: string): SlidesElement {
  return {
    id: `head-${index}`,
    type: 'text',
    frame: { x: COLUMN_X[index], y: 120, w: STICKY_W + 40, h: 90, rotation: 0 },
    data: {
      blocks: [
        {
          id: `head-${index}-p`,
          type: 'paragraph',
          style: { ...DEFAULT_BLOCK_STYLE, alignment: 'center' },
          inlines: [{ text, style: { bold: true, fontSize: 28 } }],
        },
      ],
    },
  } as SlidesElement;
}

/**
 * A sticky note.
 *
 * A sticky is a preset `roundRect` shape rather than an element type of its
 * own — see docs/design/board/board-whiteboard-elements.md — so seeding one
 * needs no board-specific model.
 */
function sticky(
  key: string,
  column: number,
  row: number,
  fill: string,
): SlidesElement {
  return {
    id: key,
    type: 'shape',
    frame: {
      x: COLUMN_X[column],
      y: 250 + row * (STICKY_H + 30),
      w: STICKY_W,
      h: STICKY_H,
      rotation: 0,
    },
    data: {
      kind: 'roundRect',
      fill: { kind: 'srgb', value: fill },
    },
  } as SlidesElement;
}

const COLUMNS = [
  { title: 'Went well', fill: '#D7F0DB' },
  { title: 'Could improve', fill: '#FDE7C7' },
  { title: 'Action items', fill: '#D9E6FB' },
];

export const retrospectiveBoard: TemplateSeed = {
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
