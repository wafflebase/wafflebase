import { DEFAULT_BLOCK_STYLE } from '@wafflebase/docs';
import { STICKY_COLORS, STICKY_SIZE, buildStickyInit } from '@wafflebase/board';
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

export const siteVisitNotes: TemplateSeed = {
  slug: 'site-visit-notes',
  title: 'Site Visit Notes',
  description:
    'A markdown note for recording an on-site visit or inspection: what you checked, what you found, and who follows up on what.',
  category: 'Business',
  tags: ['site visit', 'inspection', 'field notes', 'markdown'],
  content: {
    kind: 'note',
    document: {
      content: [
        '# Site visit: <site name>',
        '',
        '**Date:** <date> · **Arrived:** <time> · **Visited by:** <name>',
        '',
        '**Purpose:** <why this visit happened — routine check, incident follow-up, handover>',
        '',
        'Write things down while you are still on site. Note what you saw, not what you expect the fix to be.',
        '',
        '---',
        '',
        '## Conditions on arrival',
        '',
        '- Access and entry points open or closed, and why',
        '- Anything that changed since the last visit',
        '',
        '## Checks',
        '',
        '| Area / item | Result | Notes |',
        '| --- | --- | --- |',
        '| <area> | Pass | — |',
        '| <area> | Needs attention | <what and where> |',
        '',
        '## Findings',
        '',
        '- <finding> — where it is, how serious, photo reference',
        '- ',
        '',
        '## Follow-ups',
        '',
        '- [ ] <action> — owner — due',
        '- [ ] ',
        '',
        '## People spoken to',
        '',
        '- <role> — what they raised',
        '',
        '## Next visit',
        '',
        '- Date: <date>',
        '- Check first: <items left open from this visit>',
        '',
      ].join('\n'),
    },
  },
};

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
