import {
  BUILT_IN_LAYOUTS,
  DEFAULT_MASTER,
  applyLayoutToSlide,
  defaultLight,
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

/** Deterministic ids, so re-running the seed produces byte-identical content. */
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
