import {
  bandBlockNumerics,
  normalizeFontSize,
  normalizeLineHeight,
  type Block,
} from '@wafflebase/docs';
import { DEFAULT_MASTER } from './master';
import type { SlidesDocument } from './presentation';

/**
 * Band every docs text body a slides/board model carries, in place.
 *
 * A slide text body is stored as plain JSON and read back verbatim — unlike a
 * docs body, it passes through no Tree attribute codec, so nothing between a
 * peer's `doc.update` and `computeLayout` bands the numerics inside it. A
 * `fontSize: 1e9` run or an `Infinity` cell span written by one collaborator
 * is otherwise a hung or blank deck for every other viewer.
 *
 * The band therefore has to live on every reader of that shape, not just the
 * one that happened to be reviewed: `YorkieSlidesStore.read()`, the board
 * store (which holds the identical blocks under a synthetic slide), and the
 * revision-preview snapshot adapters, which parse the same JSON out of a
 * stored snapshot and hand it to `MemSlidesStore`. This module is the one
 * copy of the walk they share, so a fourth reader is a call rather than a
 * fourth chance to forget.
 *
 * Mutates and returns its argument, like `bandBlockNumerics` itself: every
 * caller passes a plain JSON copy it just materialized (`yorkieToPlain`, or
 * `YSON.parse`), never a live CRDT proxy, so there is nothing to preserve and
 * nothing else observing it.
 */

/**
 * Nesting cap for the group walk, matching the element walk's own limit — a
 * `data.children` chain a peer wrote can be arbitrarily deep (or, through a
 * concurrent edit, cyclic), and a band that blew the stack would be its own
 * denial of service.
 */
const MAX_GROUP_DEPTH = 32;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** A stored value a normalizer can read, or nothing. */
function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Band the text bodies of one element (or `ElementInit`), recursing into a
 * group's children. Typed as pass-through so a caller can wrap the object it
 * is already returning.
 */
export function bandElementNumerics<T>(element: T, depth = 0): T {
  const el = asRecord(element);
  const data = asRecord(el?.data);
  if (!el || !data) return element;
  if (el.type === 'text') {
    if (Array.isArray(data.blocks)) bandBlockNumerics(data.blocks as Block[]);
    return element;
  }
  if (el.type === 'shape') {
    const text = asRecord(data.text);
    if (text && Array.isArray(text.blocks)) {
      bandBlockNumerics(text.blocks as Block[]);
    }
    return element;
  }
  if (el.type === 'table') {
    if (!Array.isArray(data.rows)) return element;
    for (const rowEntry of data.rows as unknown[]) {
      const cells = asRecord(rowEntry)?.cells;
      if (!Array.isArray(cells)) continue;
      for (const cellEntry of cells as unknown[]) {
        const blocks = asRecord(asRecord(cellEntry)?.body)?.blocks;
        if (Array.isArray(blocks)) bandBlockNumerics(blocks as Block[]);
      }
    }
    return element;
  }
  if (el.type === 'group' && depth < MAX_GROUP_DEPTH) {
    if (!Array.isArray(data.children)) return element;
    for (const child of data.children as unknown[]) {
      bandElementNumerics(child, depth + 1);
    }
  }
  return element;
}

/**
 * Band a layout's placeholder specs and static elements. A `PlaceholderSpec`
 * is an `ElementInit`, so a text placeholder carries the same `data.blocks` a
 * slide element does — and those blocks are seeded into a real element when
 * the layout is applied.
 */
export function bandLayoutNumerics<T>(layout: T): T {
  const l = asRecord(layout);
  if (!l) return layout;
  for (const key of ['placeholders', 'staticElements'] as const) {
    const list = l[key];
    if (!Array.isArray(list)) continue;
    for (const entry of list as unknown[]) bandElementNumerics(entry);
  }
  return layout;
}

/**
 * Band a master's placeholder typography.
 *
 * A `PlaceholderStyle` is not a `Block`, but it carries the same
 * `fontSize` / `lineHeight` pair and reaches the same sinks:
 * `seedPlaceholderBlocks` copies both **verbatim** into a docs `Block` when a
 * layout is applied, and the empty-placeholder hint multiplies `fontSize`
 * straight into a canvas font. So a master stored on the Yorkie root — which
 * any collaborator can write — is a route into `computeLayout` that the block
 * bands above never see, and `masters` has no codec of its own either.
 *
 * The two normalizers are the docs ones, so the ceilings are identical to the
 * ones a run inside a body gets; nothing new is banded here. Where they *do*
 * differ is the drop branch: `PlaceholderStyle.fontSize` and `lineHeight` are
 * required numbers rather than optional ones, so a value with no usable
 * reading (`NaN`, `0`, a negative) becomes the default master's — `undefined`
 * would paint `NaNpx` in the hint and store an undefined size in the seeded
 * block. `placeholderStyles` is walked by whatever keys it has, not by the two
 * named ones, because it is an open map (`caption`, `big-number`, …).
 */
export function bandMasterNumerics<T>(master: T): T {
  const styles = asRecord(asRecord(master)?.placeholderStyles);
  if (!styles) return master;
  for (const key of Object.keys(styles)) {
    const style = asRecord(styles[key]);
    if (!style) continue;
    const fallback =
      DEFAULT_MASTER.placeholderStyles[key]
      ?? DEFAULT_MASTER.placeholderStyles.body;
    style.fontSize =
      normalizeFontSize(asFiniteNumber(style.fontSize)) ?? fallback.fontSize;
    style.lineHeight =
      normalizeLineHeight(asFiniteNumber(style.lineHeight))
      ?? fallback.lineHeight;
  }
  return master;
}

/**
 * Band every text body in a whole document — slide elements, speaker notes,
 * layout placeholders, and master typography. For readers that materialize a
 * `SlidesDocument` in one step (a parsed revision snapshot) rather than
 * element by element.
 */
export function bandSlidesDocumentNumerics(doc: SlidesDocument): SlidesDocument {
  const root = asRecord(doc);
  if (!root) return doc;
  if (Array.isArray(root.slides)) {
    for (const slideEntry of root.slides as unknown[]) {
      const slide = asRecord(slideEntry);
      if (!slide) continue;
      if (Array.isArray(slide.elements)) {
        for (const el of slide.elements as unknown[]) bandElementNumerics(el);
      }
      if (Array.isArray(slide.notes)) {
        bandBlockNumerics(slide.notes as Block[]);
      }
    }
  }
  if (Array.isArray(root.layouts)) {
    for (const layout of root.layouts as unknown[]) bandLayoutNumerics(layout);
  }
  if (Array.isArray(root.masters)) {
    for (const master of root.masters as unknown[]) bandMasterNumerics(master);
  }
  return doc;
}
