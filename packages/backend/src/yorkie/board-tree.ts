/**
 * Yorkie root <-> board content serialization for the backend.
 *
 * A board is an infinite canvas — "one unbounded slide" — so its root is not a
 * deck: there are no slides, layouts, masters or themes, just one flat
 * `elements` array in world coordinates plus a small `meta`. See
 * `docs/design/board/board.md` and the frontend's
 * `types/board-document.ts#YorkieBoardRoot`, which this mirrors.
 *
 * Until this module the backend could not read or write a board at all: the
 * content endpoint accepted `doc` / `slides` / `note` and rejected everything
 * else, which is what put board in class B of the capability audit even though
 * board documents could already be created and copied.
 *
 * The element shape is the slides `Element` — a board reuses the slides scene
 * engine unchanged — so the content endpoint validates board elements with the
 * very same walk it applies to a deck's.
 */
import type { SlidesElement } from './yorkie.types';
import { unwrapJson } from './yorkie-json';

export interface BoardMeta {
  title: string;
  unit?: 'in' | 'cm';
  recentColors?: string[];
}

/** The canonical board content JSON exchanged with the content endpoint. */
export interface BoardDocument {
  meta: BoardMeta;
  elements: SlidesElement[];
}

/**
 * The Yorkie root shape used by board documents. Every field is optional so a
 * freshly-attached (empty) document is representable.
 */
export interface BoardYorkieRoot extends Record<string, unknown> {
  meta?: BoardMeta;
  elements?: SlidesElement[];
}

/** The initial root a board document is seeded with, matching the frontend. */
export function initialBoardRoot(): BoardYorkieRoot {
  return { meta: { title: 'Untitled board' }, elements: [] };
}

/**
 * Read the Yorkie root of a board and return plain JSON.
 *
 * `unwrapJson` per field rather than a spread, for the reason the slides
 * reader documents: a Yorkie value's own `toJSON` is the only thing that walks
 * the CRDT into detached JSON, and a nested array proxy copied by spread dies
 * in `res.json()`.
 */
export function readBoardRoot(root: BoardYorkieRoot): BoardDocument {
  const meta = unwrapJson<BoardMeta>(root.meta);
  const elements = unwrapJson<SlidesElement[]>(root.elements) ?? [];
  const out: BoardDocument = {
    meta: { title: meta?.title ?? 'Untitled board' },
    elements,
  };
  if (meta?.unit !== undefined) out.meta.unit = meta.unit;
  if (meta?.recentColors !== undefined) {
    out.meta.recentColors = meta.recentColors;
  }
  return out;
}

/**
 * Destructive replace of a board's content, matching the slides writer: the
 * incoming fields overwrite the root, and `meta` is rewritten as a fresh
 * object so a stale field cannot survive a write that omitted it.
 *
 * Must be called inside `doc.update`.
 */
export function writeBoardRoot(
  root: BoardYorkieRoot,
  document: BoardDocument,
): void {
  const meta: BoardMeta = { title: document.meta.title };
  if (document.meta.unit !== undefined) meta.unit = document.meta.unit;
  if (document.meta.recentColors !== undefined) {
    meta.recentColors = document.meta.recentColors;
  }
  root.meta = meta;
  root.elements = document.elements;
}
