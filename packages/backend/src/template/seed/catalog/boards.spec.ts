import {
  SECTION_COLORS,
  buildSectionInit,
  buildStickyInit,
} from '@wafflebase/board';
import type { SlidesElement } from '../../../yorkie/yorkie.types';
import { TEMPLATE_CATALOG } from './index';

/**
 * Every board in the catalogue, so a new one is checked without anybody
 * remembering to list it. `retrospective-board` predates sections: it is
 * column headings over a stack of blank stickies, a different design these
 * section rules do not describe, so it is the one board left out.
 */
const UNSECTIONED_BOARDS = new Set(['retrospective-board']);
const BOARD_TEMPLATES = TEMPLATE_CATALOG.filter(
  (s) => s.content.kind === 'board' && !UNSECTIONED_BOARDS.has(s.slug),
);

type Data = {
  kind?: string;
  role?: string;
  section?: { title?: unknown };
  fill?: { kind?: string; value?: string };
  stroke?: { color?: string; width?: number };
  effects?: { shadow?: unknown };
  text?: { autofit?: string; verticalAnchor?: string };
};

const dataOf = (el: SlidesElement) => (el as { data: Data }).data;
const isSection = (el: SlidesElement) =>
  el.type === 'shape' && typeof dataOf(el).section?.title === 'string';
const isSticky = (el: SlidesElement) =>
  el.type === 'shape' && dataOf(el).role === 'sticky';

function elementsOf(seed: (typeof BOARD_TEMPLATES)[number]): SlidesElement[] {
  if (seed.content.kind !== 'board')
    throw new Error(`${seed.slug} is not a board`);
  return seed.content.root.elements;
}

/** Share of `inner`'s area inside `outer` — the board's membership rule. */
function overlapRatio(
  inner: SlidesElement['frame'],
  outer: SlidesElement['frame'],
) {
  const w =
    Math.min(inner.x + inner.w, outer.x + outer.w) - Math.max(inner.x, outer.x);
  const h =
    Math.min(inner.y + inner.h, outer.y + outer.h) - Math.max(inner.y, outer.y);
  return (Math.max(0, w) * Math.max(0, h)) / (inner.w * inner.h);
}

/*
 * The markers a board client keys on, written out independently of the
 * `@wafflebase/board` factories `boards.ts` builds with: a palette change
 * there is a change to every existing board, so it should fail here too.
 */
const SECTION_PAIRS = new Set([
  '#F4F4F5/#71717A',
  '#FEF9C3/#A16207',
  '#DCFCE7/#15803D',
  '#DBEAFE/#1D4ED8',
  '#FCE7F3/#BE185D',
  '#EDE9FE/#6D28D9',
]);
const STICKY_FILLS = new Set([
  '#FFF8B8',
  '#CDEFC4',
  '#C7E5FF',
  '#FFD6E7',
  '#FFE0B2',
  '#E5D4FF',
]);

describe('board templates', () => {
  it('are in the catalogue', () => {
    for (const seed of BOARD_TEMPLATES)
      expect(TEMPLATE_CATALOG).toContain(seed);
  });

  it.each(BOARD_TEMPLATES.map((s) => [s.slug, s] as const))(
    '%s is sections, stickies and title text',
    (_slug, seed) => {
      const els = elementsOf(seed);
      const sections = els.filter(isSection);
      const stickies = els.filter(isSticky);
      expect(sections.length).toBeGreaterThanOrEqual(3);
      expect(stickies.length).toBeGreaterThan(0);
      expect(els.some((e) => e.type === 'text')).toBe(true);
      // Nothing else: every element is one of the three.
      for (const e of els) {
        expect(isSection(e) || isSticky(e) || e.type === 'text').toBe(true);
      }
    },
  );

  it.each(BOARD_TEMPLATES.map((s) => [s.slug, s] as const))(
    '%s writes the section and sticky markers a board client reads',
    (_slug, seed) => {
      for (const el of elementsOf(seed)) {
        const d = dataOf(el);
        if (isSection(el)) {
          expect(d.kind).toBe('rect');
          expect(SECTION_PAIRS.has(`${d.fill?.value}/${d.stroke?.color}`)).toBe(
            true,
          );
          expect(String(d.section?.title).trim()).not.toBe('');
        }
        if (isSticky(el)) {
          // `isStickyData` would also accept this legacy shape without the
          // role, so a client that predates the marker still sees a sticky.
          expect(d.kind).toBe('roundRect');
          expect(d.fill?.kind).toBe('srgb');
          expect(STICKY_FILLS.has(String(d.fill?.value))).toBe(true);
          expect(d.effects?.shadow).toBeDefined();
          expect(d.stroke).toBeUndefined();
          expect(d.text).toMatchObject({
            autofit: 'shrink',
            verticalAnchor: 'middle',
          });
        }
      }
    },
  );

  it.each(BOARD_TEMPLATES.map((s) => [s.slug, s] as const))(
    '%s paints its sections behind its stickies and seats every sticky in one',
    (_slug, seed) => {
      const els = elementsOf(seed);
      const sections = els.filter(isSection);
      const lastSection = Math.max(...sections.map((s) => els.indexOf(s)));
      for (const sticky of els.filter(isSticky)) {
        expect(els.indexOf(sticky)).toBeGreaterThan(lastSection);
        // Geometric membership: more than half of it inside one section,
        // and fully inside, so nothing straddles a border.
        const homes = sections.filter(
          (s) => overlapRatio(sticky.frame, s.frame) > 0.5,
        );
        expect(homes).toHaveLength(1);
        expect(overlapRatio(sticky.frame, homes[0].frame)).toBe(1);
      }
    },
  );

  it('keeps sections from overlapping one another', () => {
    for (const seed of BOARD_TEMPLATES) {
      const sections = elementsOf(seed).filter(isSection);
      for (const a of sections) {
        for (const b of sections) {
          if (a === b) continue;
          expect(overlapRatio(a.frame, b.frame)).toBe(0);
        }
      }
    }
  });

  it.each(BOARD_TEMPLATES.map((s) => [s.slug, s] as const))(
    '%s builds its stickies and sections with the board factories',
    (_slug, seed) => {
      for (const el of elementsOf(seed)) {
        const d = dataOf(el);
        const { x, y, w, h } = el.frame;
        if (isSticky(el)) {
          const text = (d.text as { blocks: { inlines: { text: string }[] }[] })
            .blocks[0].inlines[0].text;
          const init = buildStickyInit(
            String(d.fill?.value),
            { x: x + w / 2, y: y + h / 2 },
            { text, fontSize: 18 },
          );
          expect({ ...el, id: undefined }).toEqual({ ...init, id: undefined });
        }
        if (isSection(el)) {
          const color = SECTION_COLORS.find((c) => c.fill === d.fill?.value)!;
          const init = buildSectionInit(
            { x, y, w, h },
            { title: String(d.section?.title), color },
          );
          expect({ ...el, id: undefined }).toEqual({ ...init, id: undefined });
        }
      }
    },
  );
});
