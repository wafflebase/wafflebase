import type { Element, SlidesEditor, SlidesStore } from "@wafflebase/slides";
import { SYNTHETIC_SLIDE_ID } from "@wafflebase/board";

/** An element to lay out: its id and its world frame. */
export interface TidyItem {
  id: string;
  frame: { x: number; y: number; w: number; h: number };
}

/** The uniform gap between tidied cells, in world px. */
export const TIDY_GAP = 24;

/** FigJam's "Tidy up" chord. */
export const TIDY_UP_SHORTCUT = "Alt+Shift+T";

/**
 * Group items into rows the way a reader sees them: sorted top to bottom,
 * an item joins the current row when it overlaps that row vertically by at
 * least half the shorter of the two heights, and each row reads left to
 * right. Half, not "any overlap", so a slightly staggered grid still reads
 * as rows while two stacked stickies that merely touch stay two rows.
 */
export function rowBands(items: readonly TidyItem[]): TidyItem[][] {
  const sorted = [...items].sort(
    (a, b) => a.frame.y - b.frame.y || a.frame.x - b.frame.x,
  );
  const bands: { top: number; bottom: number; minH: number; items: TidyItem[] }[] = [];
  for (const item of sorted) {
    const { y, h } = item.frame;
    const band = bands[bands.length - 1];
    if (band) {
      const overlap = Math.min(band.bottom, y + h) - Math.max(band.top, y);
      if (overlap >= 0.5 * Math.min(h, band.minH)) {
        band.items.push(item);
        band.top = Math.min(band.top, y);
        band.bottom = Math.max(band.bottom, y + h);
        band.minH = Math.min(band.minH, h);
        continue;
      }
    }
    bands.push({ top: y, bottom: y + h, minH: h, items: [item] });
  }
  return bands.map((b) => b.items.sort((p, q) => p.frame.x - q.frame.x));
}

/**
 * The tidied top-left of every item: an even grid that keeps the rows and
 * columns the selection already has (see {@link rowBands}), with a uniform
 * {@link TIDY_GAP} between cells. Each column is as wide as its widest item
 * and each row as tall as its tallest; an item is centred in its cell. The
 * grid's top-left sits on the selection's current top-left, so tidying
 * never moves the group somewhere else on the board.
 *
 * Fewer than two items is a no-op (empty map). Pure.
 */
export function tidyLayout(
  items: readonly TidyItem[],
  gap: number = TIDY_GAP,
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (items.length < 2) return out;
  const rows = rowBands(items);
  const cols = Math.max(...rows.map((r) => r.length));
  const colW = new Array<number>(cols).fill(0);
  const rowH = rows.map((r) => Math.max(...r.map((i) => i.frame.h)));
  for (const row of rows) {
    row.forEach((item, c) => {
      colW[c] = Math.max(colW[c], item.frame.w);
    });
  }
  const originX = Math.min(...items.map((i) => i.frame.x));
  const originY = Math.min(...items.map((i) => i.frame.y));

  let cellY = originY;
  rows.forEach((row, r) => {
    let cellX = originX;
    row.forEach((item, c) => {
      out.set(item.id, {
        x: cellX + (colW[c] - item.frame.w) / 2,
        y: cellY + (rowH[r] - item.frame.h) / 2,
      });
      cellX += colW[c] + gap;
    });
    cellY += rowH[r] + gap;
  });
  return out;
}

/**
 * Tidy the editor's current selection on the board, as one undo step.
 *
 * Only top-level, non-connector elements move: a connector follows the
 * shapes it is glued to, and laying it out as a cell of its own would
 * tear it off them. A selection inside a drilled-into group has
 * group-local frames, so it is left alone. Returns whether anything moved.
 */
export function tidyUpSelection(
  editor: Pick<SlidesEditor, "getSelection" | "isTextEditing">,
  store: Pick<SlidesStore, "read" | "batch" | "updateElementFrame">,
): boolean {
  if (editor.isTextEditing()) return false;
  const selected = new Set(editor.getSelection());
  const elements: Element[] = store.read().slides[0]?.elements ?? [];
  const items: TidyItem[] = elements
    .filter((e) => selected.has(e.id) && e.type !== "connector")
    .map((e) => ({ id: e.id, frame: e.frame }));
  const layout = tidyLayout(items);
  const moves = items.filter((i) => {
    const next = layout.get(i.id);
    return next && (next.x !== i.frame.x || next.y !== i.frame.y);
  });
  if (moves.length === 0) return false;
  store.batch(() => {
    for (const item of moves) {
      store.updateElementFrame(SYNTHETIC_SLIDE_ID, item.id, layout.get(item.id)!);
    }
  });
  return true;
}
