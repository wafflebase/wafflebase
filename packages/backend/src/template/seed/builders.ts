import {
  BUILT_IN_LAYOUTS,
  DEFAULT_MASTER,
  applyLayoutToSlide,
  defaultLight,
  getBuiltInTheme,
  type Theme,
} from '@wafflebase/slides';
import { DEFAULT_BLOCK_STYLE } from '@wafflebase/docs';
import type { Block, BlockType } from '@wafflebase/docs';
import type { Cell, CellStyle } from '@wafflebase/sheets';
import type {
  SlidesDocument,
  SlidesSlide,
  SlidesTextElement,
} from '../../yorkie/yorkie.types';

/**
 * Authoring helpers for the template catalogue.
 *
 * These exist so a template reads as its content rather than as a wall of
 * ids and frames. Everything they emit is an ordinary snapshot the product's
 * own writers accept — no seed-only shortcuts.
 */

/**
 * Readable ids, counted per module load.
 *
 * Deliberately *not* claimed to be stable across runs, which an earlier
 * version of this comment did claim: `applyLayoutToSlide` stamps every
 * placeholder it creates with `generateId()` (a random UUID prefix), and these
 * counters depend on `catalog/index.ts`'s import order, so adding a template
 * shifts the ids of everything imported after it. Neither matters — content is
 * written once, on create — but the ids are not a fixture anyone may key on.
 */
function id(prefix: string, n: number): string {
  return `${prefix}-${n}`;
}

// --------------------------------------------------------------------------
// Docs
// --------------------------------------------------------------------------

let blockCounter = 0;

/** One docs block. `bold` marks the whole line, which is all these need. */
export function block(
  type: BlockType,
  text: string,
  options?: { bold?: boolean; fontSize?: number },
): Block {
  blockCounter += 1;
  return {
    id: id('b', blockCounter),
    type,
    style: { ...DEFAULT_BLOCK_STYLE },
    inlines: [
      {
        text,
        style: {
          ...(options?.bold ? { bold: true } : {}),
          ...(options?.fontSize ? { fontSize: options.fontSize } : {}),
        },
      },
    ],
  };
}

export const title = (text: string): Block => block('title', text);

export const heading = (text: string, headingLevel: 1 | 2 | 3 = 1): Block => ({
  ...block('heading', text),
  headingLevel,
});

export const para = (text: string): Block => block('paragraph', text);

export const bullet = (text: string): Block => ({
  ...block('list-item', text),
  listKind: 'unordered',
  listLevel: 0,
});

// --------------------------------------------------------------------------
// Slides
// --------------------------------------------------------------------------

let slideCounter = 0;

/**
 * A slide on one of the built-in layouts, with its placeholders filled in
 * order.
 *
 * `applyLayoutToSlide` is what creates the placeholder elements — the same
 * call the editor makes when you pick a layout — so frames, fonts and colour
 * roles come from the layout and theme rather than being hard-coded here.
 * `texts` then fills each placeholder in slot order; a slot with no entry
 * keeps the empty block the layout seeded, which is exactly what an unfilled
 * placeholder is.
 */
export function slide(layoutId: string, texts: string[][]): SlidesSlide {
  slideCounter += 1;
  // Looked up here rather than through `getLayout`, which falls back to the
  // blank layout for an unknown id — a typo in the catalogue would then
  // silently produce an empty slide instead of failing the seed.
  const layout = BUILT_IN_LAYOUTS.find((l) => l.id === layoutId);
  if (!layout) throw new Error(`Unknown layout: ${layoutId}`);

  const s: SlidesSlide = {
    id: id('s', slideCounter),
    layoutId,
    background: {},
    elements: [],
    notes: [],
  };
  applyLayoutToSlide(s, layout, {
    master: DEFAULT_MASTER,
    theme: defaultLight,
  });

  const placeholders = s.elements.filter(
    (e): e is SlidesTextElement => e.type === 'text' && !!e.placeholderRef,
  );
  texts.forEach((lines, i) => {
    const target = placeholders[i];
    if (!target) return;
    // Keep the seeded block as the style carrier and re-key it per line, so
    // the placeholder's theme-resolved font and colour survive.
    const seed = target.data.blocks[0];
    target.data.blocks = lines.map((text, li) => ({
      ...seed,
      id: `${target.id}-p${li}`,
      inlines: [{ ...seed.inlines[0], text }],
    }));
  });
  return s;
}

/** A deck on the default light theme with the built-in layouts. */
export function deck(title: string, slides: SlidesSlide[]): SlidesDocument {
  return {
    meta: { title, themeId: defaultLight.id, masterId: DEFAULT_MASTER.id },
    themes: [defaultLight],
    masters: [DEFAULT_MASTER],
    layouts: BUILT_IN_LAYOUTS,
    slides,
  } as SlidesDocument;
}

/**
 * Composition presets applied over a slide's placeholder text. A template
 * mixes these so its slides read as a designed deck (colour blocks, sidebars,
 * geometric accents) rather than text on a blank background.
 */
export type Decor =
  | 'plain'
  | 'block'
  | 'gradient'
  | 'header'
  | 'band'
  | 'geo'
  | 'dots'
  | 'diagonal'
  | 'sidebar'
  | 'split';

const SW = 1920;
const SH = 1080;

type Fill =
  | { kind: 'role'; role: string }
  | {
      kind: 'gradient';
      type: 'linear';
      angle: number;
      stops: Array<{ pos: number; color: { kind: 'role'; role: string } }>;
    };

const rf = (role: string): Fill => ({ kind: 'role', role });
const grad = (r1: string, r2: string, angle = 0.5): Fill => ({
  kind: 'gradient',
  type: 'linear',
  angle,
  stops: [
    { pos: 0, color: { kind: 'role', role: r1 } },
    { pos: 1, color: { kind: 'role', role: r2 } },
  ],
});

function shapeEl(
  idStr: string,
  kind: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: Fill,
  rotation = 0,
): unknown {
  return {
    id: idStr,
    type: 'shape',
    frame: { x, y, w, h, rotation },
    data: { kind, fill },
  };
}

/** Recolour inlines (of text elements above `maxY`) to a theme role. */
function recolor(texts: SlidesTextElement[], role: string, maxY = Infinity): void {
  for (const t of texts) {
    if (t.frame.y > maxY) continue;
    for (const b of t.data.blocks) {
      // Inline colour is a theme role ref; cast through `any` because the
      // seed's InlineStyle type does not surface the role-colour shape here.
      for (const inl of b.inlines as unknown as Array<Record<string, unknown>>) {
        inl.style = {
          ...((inl.style as Record<string, unknown>) ?? {}),
          color: { kind: 'role', role },
        };
      }
    }
  }
}

/**
 * Paint a composition preset under the slide's placeholder text. Every slide is
 * decorated — `plain` still gets a light, consistent base treatment (an accent
 * spine + mark) so the whole deck reads as one designed presentation, not a
 * designed cover in front of blank content slides.
 */
function decorate(slide: SlidesSlide, style: Decor, tag: string): void {
  const texts = slide.elements.filter(
    (e): e is SlidesTextElement => e.type === 'text' && !!e.placeholderRef,
  );
  const under: unknown[] = [];
  switch (style) {
    case 'plain':
      under.push(
        shapeEl(`${tag}-spine`, 'rect', 0, 0, 14, SH, rf('accent1')),
        shapeEl(`${tag}-mark`, 'rect', 64, 64, 72, 12, rf('accent2')),
      );
      break;
    case 'block':
      under.push(
        shapeEl(`${tag}-bg`, 'rect', 0, 0, SW, SH, rf('accent1')),
        shapeEl(`${tag}-o`, 'ellipse', SW - 520, SH - 420, 1100, 1100, rf('accent2')),
      );
      recolor(texts, 'background');
      break;
    case 'gradient':
      under.push(
        shapeEl(`${tag}-bg`, 'rect', 0, 0, SW, SH, grad('accent1', 'accent2', 0.5)),
      );
      recolor(texts, 'background');
      break;
    case 'header':
      under.push(shapeEl(`${tag}-hd`, 'rect', 0, 0, SW, 300, rf('accent1')));
      recolor(texts, 'background', 300);
      break;
    case 'band':
      under.push(
        shapeEl(`${tag}-line`, 'rect', 0, 832, SW, 8, rf('accent3')),
        shapeEl(`${tag}-band`, 'rect', 0, 840, SW, SH - 840, rf('accent1')),
        shapeEl(`${tag}-dot`, 'ellipse', 150, 748, 200, 200, rf('accent2')),
      );
      break;
    case 'geo':
      under.push(
        shapeEl(`${tag}-c1`, 'ellipse', 1360, 640, 900, 900, rf('accent1')),
        shapeEl(`${tag}-c2`, 'ellipse', 1630, 120, 240, 240, rf('accent2')),
        shapeEl(`${tag}-d`, 'diamond', 1180, 720, 170, 170, rf('accent3')),
      );
      break;
    case 'dots':
      under.push(
        shapeEl(`${tag}-a`, 'ellipse', 1680, 110, 190, 190, rf('accent1')),
        shapeEl(`${tag}-b`, 'ellipse', 1500, 300, 96, 96, rf('accent2')),
        shapeEl(`${tag}-c`, 'ellipse', 1770, 410, 64, 64, rf('accent3')),
        shapeEl(`${tag}-e`, 'ellipse', 1590, 90, 52, 52, rf('accent2')),
      );
      break;
    case 'diagonal':
      under.push(
        shapeEl(`${tag}-di`, 'rect', -320, 820, 2700, 460, rf('accent1'), 0.11),
        shapeEl(`${tag}-do`, 'ellipse', 120, 120, 150, 150, rf('accent2')),
      );
      break;
    case 'sidebar':
    case 'split': {
      const w = style === 'split' ? 960 : 640;
      under.push(
        shapeEl(`${tag}-side`, 'rect', 0, 0, w, SH, rf('accent1')),
        shapeEl(`${tag}-so`, 'ellipse', w - 360, SH - 360, 520, 520, rf('accent2')),
        shapeEl(`${tag}-sl`, 'rect', w - 8, 0, 8, SH, rf('accent3')),
      );
      // Move the placeholder text off the colour column into the open area.
      for (const t of texts) {
        if (t.frame.x < w) {
          const nx = w + 100;
          t.frame.x = nx;
          t.frame.w = Math.max(240, SW - nx - 128);
        }
      }
      break;
    }
  }
  slide.elements = [
    ...(under as unknown as typeof slide.elements),
    ...slide.elements,
  ];
}

/**
 * A deck on a chosen theme. Slides are `[layoutId, texts]` or
 * `[layoutId, texts, decor]` tuples: the whole deck shares one theme, and each
 * slide can carry a composition preset (see {@link Decor}) so a template reads
 * as a designed deck, not text on a blank background. `themeId`/`themes` embed
 * the theme so the deck renders with that look even before the picker opens.
 */
export function themedDeck(
  theme: Theme | string,
  title: string,
  slideSpecs: Array<[string, string[][]] | [string, string[][], Decor]>,
): SlidesDocument {
  // A string is a built-in theme id. `getBuiltInTheme` falls back to
  // default-light for an unknown id, which would silently strip a template's
  // look — so verify the resolved id matches and fail the seed on a typo.
  let resolvedTheme: Theme;
  if (typeof theme === 'string') {
    resolvedTheme = getBuiltInTheme(theme);
    if (resolvedTheme.id !== theme) {
      throw new Error(`Unknown built-in theme id: ${theme}`);
    }
  } else {
    resolvedTheme = theme;
  }

  const slides = slideSpecs.map((spec) => {
    const [layoutId, texts, style] = spec;
    slideCounter += 1;
    const layout = BUILT_IN_LAYOUTS.find((l) => l.id === layoutId);
    if (!layout) throw new Error(`Unknown layout: ${layoutId}`);

    const s: SlidesSlide = {
      id: id('s', slideCounter),
      layoutId,
      background: {},
      elements: [],
      notes: [],
    };
    applyLayoutToSlide(s, layout, {
      master: DEFAULT_MASTER,
      theme: resolvedTheme,
    });

    const placeholders = s.elements.filter(
      (e): e is SlidesTextElement => e.type === 'text' && !!e.placeholderRef,
    );
    texts.forEach((lines, i) => {
      const target = placeholders[i];
      if (!target) return;
      const seed = target.data.blocks[0];
      target.data.blocks = lines.map((text, li) => ({
        ...seed,
        id: `${target.id}-p${li}`,
        inlines: [{ ...seed.inlines[0], text }],
      }));
    });

    decorate(s, (style as Decor) ?? 'plain', `d${slideCounter}`);
    return s;
  });

  return {
    meta: {
      title,
      themeId: resolvedTheme.id,
      masterId: DEFAULT_MASTER.id,
    },
    themes: [resolvedTheme],
    masters: [DEFAULT_MASTER],
    layouts: BUILT_IN_LAYOUTS,
    slides,
  } as SlidesDocument;
}

// --------------------------------------------------------------------------
// Sheets
// --------------------------------------------------------------------------

/** Header cell: bold on a light fill, which is what every sheet here uses. */
export const th = (v: string): Cell => ({
  v,
  s: { b: true, bg: '#F1F3F4' },
});

export const cell = (v: string, s?: CellStyle): Cell => ({
  v,
  ...(s ? { s } : {}),
});

/**
 * A formula cell, carrying the value it currently evaluates to.
 *
 * The cached `v` is not optional decoration. The calculator is async and needs
 * a live `Sheet`, so nothing recomputes a formula until an editor session
 * opens the document — and a template is *previewed* far more often than it is
 * opened. Without `v`, every derived column reads blank on the one screen that
 * decides whether somebody uses the template, which looks broken rather than
 * empty. Caching the value beside the formula is what a real `.xlsx` does, and
 * the first edit recalculates it like any other cell.
 *
 * The catalogue test recomputes these, so a sample number that is edited
 * without updating its total fails CI rather than shipping a wrong sum.
 */
export const formula = (f: string, v: string, s?: CellStyle): Cell => ({
  f,
  v,
  ...(s ? { s } : {}),
});

const USD: CellStyle = { nf: 'currency', cu: 'USD' };

export const money = (v: string): Cell => ({ v, s: { ...USD } });

export const moneyFormula = (f: string, v: string): Cell => ({
  f,
  v,
  s: { ...USD },
});

export const boldMoneyFormula = (f: string, v: string): Cell => ({
  f,
  v,
  s: { ...USD, b: true },
});

/**
 * Lay a rectangular block of cells out from `A1`-style top-left corner.
 * Returns an A1-keyed record ready for `SeedContent`.
 */
export function rows(
  startRef: string,
  table: (Cell | null)[][],
): Record<string, Cell> {
  const m = /^([A-Z]+)(\d+)$/.exec(startRef);
  if (!m) throw new Error(`Bad start ref: ${startRef}`);
  const startCol = colIndex(m[1]);
  const startRow = Number(m[2]);

  const out: Record<string, Cell> = {};
  table.forEach((row, r) => {
    row.forEach((c, i) => {
      if (c === null) return;
      out[`${colName(startCol + i)}${startRow + r}`] = c;
    });
  });
  return out;
}

function colIndex(name: string): number {
  let n = 0;
  for (const ch of name) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function colName(index: number): string {
  let n = index;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
