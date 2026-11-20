import { DEFAULT_BLOCK_STYLE } from '@wafflebase/docs';
import {
  SECTION_COLORS,
  STICKY_COLORS,
  STICKY_SIZE,
  buildSectionInit,
  buildStickyInit,
} from '@wafflebase/board';
import type { SlidesElement } from '../../../yorkie/yorkie.types';
import type { TemplateSeed } from '../types';

/*
 * Board templates built from the board's own objects: sections, sticky
 * notes and title text (docs/design/board/board-figjam-parity.md, the tool
 * dock pass). Everything here is original to this repository (see
 * README.md).
 *
 * Stickies and sections come out of the same `@wafflebase/board`
 * factories the canvas and the `/api/v1` board endpoints use
 * (`buildStickyInit`, `buildSectionInit`), so a template's sticky is the
 * element a person makes, and a change to either marker reaches the
 * templates with it. Membership is geometric: a sticky belongs to the
 * section whose frame holds most of it.
 *
 * Sections come first in each element list, so they paint behind the
 * stickies on them.
 */

type StickyColor = 'yellow' | 'green' | 'blue' | 'pink' | 'orange' | 'purple';
type SectionColorName =
  | 'gray'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'pink'
  | 'purple';

function byName<T extends { name: string }>(
  list: readonly T[],
  name: string,
): T {
  const found = list.find((c) => c.name.toLowerCase() === name);
  if (!found) throw new Error(`board template: unknown colour ${name}`);
  return found;
}

/** Gutter between stickies inside a section. */
const GAP = 24;
/** Gutter between sections, across and down: one rhythm on every board. */
const SECTION_GAP = 48;
/** Room above a section's first row for its title pill. */
const SECTION_HEAD = 72;
const SECTION_PAD = 40;
/** Sticky text size in the templates. */
const STICKY_FONT_SIZE = 18;

/** Board title, and the brief under it. */
const TITLE_FONT_SIZE = 40;
const BRIEF_FONT_SIZE = 20;
const TITLE_H = 64;
/** One line of brief text. */
const BRIEF_LINE_H = 30;
/**
 * A generous average glyph advance for the brief, in ems, so the line
 * estimate below errs towards a second line rather than overlapping the
 * sections when the board is narrow.
 */
const BRIEF_EM_PER_CHAR = 0.6;
/** Title to brief: close, so the two read as one heading. */
const TITLE_TO_BRIEF = 12;

/** The theme's text colour, as the slides editor seeds new text. */
const TEXT_COLOR = { kind: 'role', role: 'text' } as const;
/** The theme's secondary text colour, a step below the title. */
const BRIEF_COLOR = { kind: 'role', role: 'textSecondary' } as const;

function paragraph(
  id: string,
  text: string,
  style: Record<string, unknown>,
  alignment: 'left' | 'center' = 'left',
) {
  return {
    id,
    type: 'paragraph',
    style: { ...DEFAULT_BLOCK_STYLE, alignment },
    inlines: [{ text, style: { color: TEXT_COLOR, ...style } }],
  };
}

/**
 * A title (and optional brief) above the sections, left-aligned with the
 * first section at x = 0 and spanning `w`. The block ends one section gap
 * above y = 0, where the sections start, so the heading sits apart from
 * the work area at the same distance on every board, however many lines
 * the brief wraps to.
 */
function title(
  id: string,
  w: number,
  text: string,
  brief?: string,
): SlidesElement[] {
  const briefW = brief ? brief.length * BRIEF_EM_PER_CHAR * BRIEF_FONT_SIZE : 0;
  const briefLines = Math.ceil(briefW / w);
  const briefH = briefLines * BRIEF_LINE_H;
  // A brief that wraps is set in a box sized to share its text evenly
  // between the lines, so the last line is not a one-word orphan.
  const briefBoxW =
    briefLines > 1 ? Math.min(w, Math.ceil(briefW / briefLines)) : w;
  const y = -(TITLE_H + (brief ? TITLE_TO_BRIEF + briefH : 0) + SECTION_GAP);
  const out: SlidesElement[] = [
    {
      id,
      type: 'text',
      frame: { x: 0, y, w, h: TITLE_H, rotation: 0 },
      data: {
        blocks: [
          paragraph(`${id}-p`, text, {
            bold: true,
            fontSize: TITLE_FONT_SIZE,
          }),
        ],
      },
    } as SlidesElement,
  ];
  if (brief) {
    out.push({
      id: `${id}-brief`,
      type: 'text',
      frame: {
        x: 0,
        y: y + TITLE_H + TITLE_TO_BRIEF,
        w: briefBoxW,
        h: briefH,
        rotation: 0,
      },
      data: {
        blocks: [
          paragraph(`${id}-brief-p`, brief, {
            fontSize: BRIEF_FONT_SIZE,
            color: BRIEF_COLOR,
          }),
        ],
      },
    } as SlidesElement);
  }
  return out;
}

/** A titled section whose top-left corner is (x, y). */
function section(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  heading: string,
  color: SectionColorName,
): SlidesElement {
  const init = buildSectionInit(
    { x, y, w, h },
    { title: heading, color: byName(SECTION_COLORS, color) },
  );
  return { ...init, id } as unknown as SlidesElement;
}

/** A sticky note whose top-left corner is (x, y); `text` may be empty. */
function sticky(
  id: string,
  x: number,
  y: number,
  color: StickyColor,
  text = '',
): SlidesElement {
  const init = buildStickyInit(
    byName(STICKY_COLORS, color).value,
    { x: x + STICKY_SIZE / 2, y: y + STICKY_SIZE / 2 },
    { text, fontSize: STICKY_FONT_SIZE },
  );
  return { ...init, id } as unknown as SlidesElement;
}

/** Width of a section that holds `cols` stickies side by side. */
function sectionWidth(cols: number): number {
  return SECTION_PAD * 2 + cols * STICKY_SIZE + (cols - 1) * GAP;
}

/** Height of a section that holds `rows` rows of stickies. */
function sectionHeight(rows: number): number {
  return SECTION_HEAD + SECTION_PAD + rows * STICKY_SIZE + (rows - 1) * GAP;
}

/**
 * Stickies laid out row-major inside the section at (sx, sy), `cols` per
 * row. Ids are `${prefix}-${index}`.
 */
function stickiesIn(
  prefix: string,
  sx: number,
  sy: number,
  cols: number,
  color: StickyColor,
  texts: string[],
): SlidesElement[] {
  return texts.map((text, i) =>
    sticky(
      `${prefix}-${i}`,
      sx + SECTION_PAD + (i % cols) * (STICKY_SIZE + GAP),
      sy + SECTION_HEAD + Math.floor(i / cols) * (STICKY_SIZE + GAP),
      color,
      text,
    ),
  );
}

// --------------------------------------------------------------------------
// Retro (Start / Stop / Continue)
// --------------------------------------------------------------------------

const RETRO_COLUMNS = [
  {
    key: 'start',
    heading: 'Start',
    section: 'green',
    sticky: 'green',
    prompts: ['What should we begin doing?', ''],
  },
  {
    key: 'stop',
    heading: 'Stop',
    section: 'pink',
    sticky: 'pink',
    prompts: ['What is slowing us down?', ''],
  },
  {
    key: 'continue',
    heading: 'Continue',
    section: 'blue',
    sticky: 'blue',
    prompts: ['What is working that we should keep?', ''],
  },
] as const;

function retroElements(): SlidesElement[] {
  const w = sectionWidth(2);
  const h = sectionHeight(3);
  const stride = w + SECTION_GAP;
  const actionsY = h + SECTION_GAP;
  const actionsW = stride * 2 + w;
  return [
    ...RETRO_COLUMNS.map((c, i) =>
      section(`retro-${c.key}`, i * stride, 0, w, h, c.heading, c.section),
    ),
    section(
      'retro-actions',
      0,
      actionsY,
      actionsW,
      sectionHeight(1),
      'Action items',
      'yellow',
    ),
    ...title(
      'retro-title',
      actionsW,
      'Retro: Start, Stop, Continue',
      'Add stickies to each column (press S), group the duplicates, then vote on what to act on.',
    ),
    ...RETRO_COLUMNS.flatMap((c, i) =>
      stickiesIn(`retro-${c.key}-sticky`, i * stride, 0, 2, c.sticky, [
        ...c.prompts,
      ]),
    ),
    ...stickiesIn('retro-actions-sticky', 0, actionsY, 4, 'yellow', [
      'Action, owner, due date',
      '',
    ]),
  ];
}

export const retroStartStopContinue: TemplateSeed = {
  slug: 'board-retro-start-stop-continue',
  title: 'Retro (Start / Stop / Continue)',
  description:
    'A team retrospective on a board: Start, Stop and Continue sections with prompt stickies, and an action-items row to close on.',
  category: 'Project management',
  tags: ['retro', 'agile', 'board', 'workshop'],
  content: {
    kind: 'board',
    root: {
      meta: { title: 'Retro: Start, Stop, Continue' },
      elements: retroElements(),
    },
  },
};

// --------------------------------------------------------------------------
// Brainstorm (affinity map)
// --------------------------------------------------------------------------

function brainstormElements(): SlidesElement[] {
  const ideasW = sectionWidth(3);
  const ideasH = sectionHeight(3);
  const themeW = sectionWidth(2);
  // Two theme rows stand exactly as tall as the Ideas section beside them,
  // so the board's bottom edge is one line.
  const themeH = (ideasH - SECTION_GAP) / 2;
  const themesX = ideasW + SECTION_GAP;
  const themes = [
    { key: 'a', heading: 'Theme A', color: 'blue' },
    { key: 'b', heading: 'Theme B', color: 'green' },
    { key: 'c', heading: 'Theme C', color: 'purple' },
    { key: 'd', heading: 'Theme D', color: 'pink' },
  ] as const;
  const themeAt = (i: number) => ({
    x: themesX + (i % 2) * (themeW + SECTION_GAP),
    y: Math.floor(i / 2) * (themeH + SECTION_GAP),
  });
  return [
    section('brainstorm-ideas', 0, 0, ideasW, ideasH, 'Ideas', 'yellow'),
    ...themes.map((t, i) =>
      section(
        `brainstorm-theme-${t.key}`,
        themeAt(i).x,
        themeAt(i).y,
        themeW,
        themeH,
        t.heading,
        t.color,
      ),
    ),
    ...title(
      'brainstorm-title',
      themesX + themeW * 2 + SECTION_GAP,
      'Brainstorm: affinity map',
      'Everyone adds ideas, one per sticky. Then drag similar ones into a theme, rename it, and vote.',
    ),
    ...stickiesIn('brainstorm-idea', 0, 0, 3, 'yellow', [
      'One idea per sticky',
      'Write it so it makes sense without you',
      '',
      '',
      '',
      '',
    ]),
  ];
}

export const brainstormAffinityMap: TemplateSeed = {
  slug: 'board-brainstorm-affinity-map',
  title: 'Brainstorm (affinity map)',
  description:
    'Collect ideas as stickies, then cluster them into named themes. An Ideas section to fill and four theme sections to sort into.',
  category: 'Design',
  tags: ['brainstorm', 'affinity map', 'board', 'workshop'],
  content: {
    kind: 'board',
    root: {
      meta: { title: 'Brainstorm' },
      elements: brainstormElements(),
    },
  },
};

// --------------------------------------------------------------------------
// Weekly team sync
// --------------------------------------------------------------------------

const SYNC_SECTIONS = [
  {
    key: 'wins',
    heading: 'Wins',
    section: 'green',
    sticky: 'green',
    prompt: 'What went well this week?',
  },
  {
    key: 'updates',
    heading: 'Updates',
    section: 'blue',
    sticky: 'blue',
    prompt: 'What changed since last week?',
  },
  {
    key: 'blockers',
    heading: 'Blockers',
    section: 'pink',
    sticky: 'pink',
    prompt: 'What is stuck, and who can unstick it?',
  },
  {
    key: 'decisions',
    heading: 'Decisions and actions',
    section: 'yellow',
    sticky: 'yellow',
    prompt: 'Decision or action, owner, due date',
  },
] as const;

function syncElements(): SlidesElement[] {
  const w = sectionWidth(2);
  const h = sectionHeight(2);
  // Two by two, read left to right then down, so the board opens close
  // to the screen's proportions instead of as one thin strip, and the
  // call ends on Blockers then Decisions, side by side.
  const at = (i: number) => ({
    x: (i % 2) * (w + SECTION_GAP),
    y: Math.floor(i / 2) * (h + SECTION_GAP),
  });
  return [
    ...SYNC_SECTIONS.map((s, i) =>
      section(`sync-${s.key}`, at(i).x, at(i).y, w, h, s.heading, s.section),
    ),
    ...title(
      'sync-title',
      w * 2 + SECTION_GAP,
      'Weekly team sync',
      'Add your stickies before the call. Spend the call on blockers and decisions.',
    ),
    ...SYNC_SECTIONS.flatMap((s, i) =>
      stickiesIn(`sync-${s.key}-sticky`, at(i).x, at(i).y, 2, s.sticky, [
        s.prompt,
        '',
      ]),
    ),
  ];
}

export const weeklyTeamSync: TemplateSeed = {
  slug: 'board-weekly-team-sync',
  title: 'Weekly team sync',
  description:
    'A board for a weekly team meeting: wins, updates, blockers, and decisions with owners, filled in before the call.',
  category: 'Business',
  tags: ['meeting', 'team', 'board', 'weekly'],
  content: {
    kind: 'board',
    root: {
      meta: { title: 'Weekly team sync' },
      elements: syncElements(),
    },
  },
};

// --------------------------------------------------------------------------
// Pricing workshop
// --------------------------------------------------------------------------

function pricingElements(): SlidesElement[] {
  const narrowW = sectionWidth(2);
  const wideW = sectionWidth(3);
  const totalW = narrowW + SECTION_GAP + wideW;
  const topH = sectionHeight(2);
  const midY = topH + SECTION_GAP;
  const midH = sectionHeight(1);
  const decisionsY = midY + midH + SECTION_GAP;
  return [
    section('pricing-goals', 0, 0, narrowW, topH, 'Goals', 'purple'),
    section(
      'pricing-options',
      narrowW + SECTION_GAP,
      0,
      wideW,
      topH,
      'Pricing options',
      'blue',
    ),
    section('pricing-tiers', 0, midY, wideW, midH, 'Tiers to test', 'green'),
    section(
      'pricing-risks',
      wideW + SECTION_GAP,
      midY,
      narrowW,
      midH,
      'Risks and open questions',
      'pink',
    ),
    section(
      'pricing-decisions',
      0,
      decisionsY,
      totalW,
      sectionHeight(1),
      'Decisions',
      'yellow',
    ),
    ...title(
      'pricing-title',
      totalW,
      'Pricing workshop: <product>',
      'Agree on the goal first, add one pricing option per sticky, then shape the strongest into tiers and vote.',
    ),
    ...stickiesIn('pricing-goals-sticky', 0, 0, 2, 'purple', [
      'Who are we pricing for? <segment>',
      'What is the goal? <growth, revenue>',
      'Constraints: <billing system, contracts, competitors>',
      '',
    ]),
    ...stickiesIn(
      'pricing-options-sticky',
      narrowW + SECTION_GAP,
      0,
      3,
      'blue',
      [
        'Per-seat price for teams',
        'Free plan up to <limit>',
        'Discount for paying annually',
        'Usage-based add-on for <resource>',
        'Plan for a segment, e.g. education',
        '',
      ],
    ),
    ...stickiesIn('pricing-tiers-sticky', 0, midY, 3, 'green', [
      'Free: <what is included>',
      '<Plan>: <price> per <unit>',
      '<Plan>: <price> per <unit>',
    ]),
    ...stickiesIn(
      'pricing-risks-sticky',
      wideW + SECTION_GAP,
      midY,
      2,
      'pink',
      ['What could make existing customers churn?', ''],
    ),
    ...stickiesIn('pricing-decisions-sticky', 0, decisionsY, 4, 'yellow', [
      'Decision, owner, next step',
      '',
    ]),
  ];
}

export const pricingWorkshop: TemplateSeed = {
  slug: 'board-pricing-workshop',
  title: 'Pricing workshop',
  description:
    'A board for working out how to price a product: goals and constraints, candidate pricing options, tiers to test, risks, and the decisions you leave with.',
  category: 'Business',
  tags: ['pricing', 'strategy', 'board', 'workshop'],
  content: {
    kind: 'board',
    root: {
      meta: { title: 'Pricing workshop' },
      elements: pricingElements(),
    },
  },
};
