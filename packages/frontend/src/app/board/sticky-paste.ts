import {
  SLIDES_CLIPBOARD_MIME,
  deserializeElements,
  type Frame,
  type Point,
} from "@wafflebase/slides";
import { hasImageFile } from "../slides/slides-image-input";

/** The most stickies one paste creates; the rest of the text is dropped. */
export const MAX_PASTED_STICKIES = 100;

/**
 * Pasted plain text as a grid of sticky texts, `''` marking an empty slot.
 *
 * - Tab-separated rows (cells copied from a spreadsheet) keep their shape:
 *   one sticky per non-empty cell, at the cell's row and column.
 * - Otherwise each non-empty line is one sticky, laid out in a near-square
 *   grid in reading order, so a pasted list becomes a block of notes rather
 *   than one long row off the edge of the screen.
 *
 * Blank rows are dropped in both cases; an all-blank text yields `[]`.
 */
export function parsePastedCells(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.some((l) => l.includes("\t"))) {
    return lines
      .map((l) => l.split("\t").map((c) => c.trim()))
      .filter((row) => row.some((c) => c !== ""));
  }
  const items = lines.map((l) => l.trim()).filter((l) => l !== "");
  if (items.length === 0) return [];
  const cols = Math.ceil(Math.sqrt(items.length));
  const rows: string[][] = [];
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
  return rows;
}

/** One sticky a paste creates: its text and world centre. */
export interface PastedSticky {
  text: string;
  center: Point;
}

/**
 * Lay a cell grid out as stickies of `size` with `gap` between them,
 * centred on `center`, skipping empty cells, capped at `limit` stickies in
 * reading order. Returns the stickies and how many cells were dropped.
 */
export function layoutPastedStickies(
  grid: readonly (readonly string[])[],
  center: Point,
  size: { w: number; h: number },
  gap: number,
  limit = MAX_PASTED_STICKIES,
): { stickies: PastedSticky[]; dropped: number } {
  const cols = grid.reduce((n, row) => Math.max(n, row.length), 0);
  const rows = grid.length;
  const stepX = size.w + gap;
  const stepY = size.h + gap;
  const originX = center.x - ((cols - 1) * stepX) / 2;
  const originY = center.y - ((rows - 1) * stepY) / 2;
  const stickies: PastedSticky[] = [];
  let dropped = 0;
  grid.forEach((row, r) => {
    row.forEach((text, c) => {
      if (text === "") return;
      if (stickies.length >= limit) {
        dropped++;
        return;
      }
      stickies.push({
        text,
        center: { x: originX + c * stepX, y: originY + r * stepY },
      });
    });
  });
  return { stickies, dropped };
}

/** Whether `text` is a slides/board element clipboard payload. */
export function isElementClipboardText(text: string): boolean {
  const t = text.trimStart();
  if (!t.startsWith("{") && !t.startsWith("[")) return false;
  try {
    deserializeElements(text);
    return true;
  } catch {
    return false;
  }
}

/** The subset of a `ClipboardEvent['clipboardData']` the paste path reads. */
interface ClipboardLike {
  types: ArrayLike<string>;
  getData(type: string): string;
  items?: ArrayLike<{ kind: string; type: string; getAsFile(): File | null }>;
  files?: ArrayLike<File>;
}

/**
 * The plain text a board paste should turn into stickies, or `null` when
 * the paste belongs to another path: an element payload (the editor's own
 * Cmd+V rule pastes those), an image (the image paste path), or no text.
 */
export function stickyTextFromClipboard(data: ClipboardLike | null): string | null {
  if (!data) return null;
  if (Array.from(data.types).includes(SLIDES_CLIPBOARD_MIME)) return null;
  if (hasImageFile(data)) return null;
  const text = data.getData("text/plain");
  if (!text || text.trim() === "") return null;
  if (isElementClipboardText(text)) return null;
  return text;
}

/**
 * Where a pasted or duplicated copy lands on the board: the slides
 * `(10, 10)` nudge while that keeps it on screen, otherwise centred in
 * the viewport. On an unbounded plane the source of a copy is often far
 * away, and a paste the user cannot see reads as a paste that failed.
 */
export function boardPasteOffset(
  bounds: Frame,
  visible: Frame,
  nudge = 10,
): { dx: number; dy: number } {
  const cx = bounds.x + bounds.w / 2 + nudge;
  const cy = bounds.y + bounds.h / 2 + nudge;
  const onScreen =
    cx >= visible.x &&
    cx <= visible.x + visible.w &&
    cy >= visible.y &&
    cy <= visible.y + visible.h;
  if (onScreen) return { dx: nudge, dy: nudge };
  return {
    dx: Math.round(visible.x + visible.w / 2 - (bounds.x + bounds.w / 2)),
    dy: Math.round(visible.y + visible.h / 2 - (bounds.y + bounds.h / 2)),
  };
}
