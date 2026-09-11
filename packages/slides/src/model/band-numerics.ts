import {
  MAX_TABLE_COLUMNS,
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
 * Band a table element's `data.columnWidths`, in place.
 *
 * The array's *length* is `computeTableLayout`'s `nCols`
 * (`packages/slides/src/view/canvas/table-renderer.ts`): it allocates
 * `nCols + 1` offsets and then loops once per (row, column) pair — whether or
 * not a cell exists there. So a peer-written `columnWidths` of a million
 * entries is a hung paint for every other viewer, exactly like the docs block
 * table's own `columnWidths` the docs codec already caps at
 * `MAX_TABLE_COLUMNS`. This is that cap's twin for the slides *element*
 * shape, which passes through no codec at all.
 *
 * A width that cannot be used becomes `0` rather than being dropped, so every
 * later column keeps its index (`colX` is a running sum, and one `NaN` entry
 * would otherwise poison every boundary after it). Unlike the docs ratios,
 * these are absolute slide units, so there is no magnitude ceiling to apply —
 * a legitimate full-bleed column is wider than any ratio band would allow, and
 * an absurdly wide finite one paints offscreen rather than hanging.
 */
function bandTableColumnWidths(data: Record<string, unknown>): void {
  if (!Array.isArray(data.columnWidths)) return;
  data.columnWidths = (data.columnWidths as unknown[])
    .slice(0, MAX_TABLE_COLUMNS)
    .map((width) => Math.max(0, asFiniteNumber(width) ?? 0));
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
    bandTableColumnWidths(data);
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
    bandPlaceholderStyleNumerics(styles[key], key);
  }
  return master;
}

/**
 * Band **one** placeholder style, in place, the way {@link bandMasterNumerics}
 * bands each of a master's.
 *
 * Split out because the master is not always the object a caller holds: the
 * store's `cascadeMasterStyles` pulls a single style out of the live CRDT by
 * placeholder type and feeds it straight to `seedPlaceholderBlocks`, which
 * *commits* the numbers into real slide blocks. Banding the whole master there
 * would mean materializing one, so it bands the slot it reads instead.
 *
 * `type` selects the default-master fallback for a value with no usable
 * reading; an unknown one falls back to `body`.
 */
export function bandPlaceholderStyleNumerics<T>(style: T, type: string): T {
  const record = asRecord(style);
  if (!record) return style;
  const defaults = DEFAULT_MASTER.placeholderStyles as Record<
    string,
    { fontSize: number; lineHeight: number } | undefined
  >;
  // `Object.prototype.hasOwnProperty` rather than a bare index: `type` comes
  // out of the CRDT, so `constructor` or `__proto__` would otherwise read a
  // prototype member and defeat the band for that slot.
  const fallback =
    (Object.prototype.hasOwnProperty.call(defaults, type)
      ? defaults[type]
      : undefined) ?? DEFAULT_MASTER.placeholderStyles.body;
  record.fontSize =
    normalizeFontSize(asFiniteNumber(record.fontSize)) ?? fallback.fontSize;
  record.lineHeight =
    normalizeLineHeight(asFiniteNumber(record.lineHeight))
    ?? fallback.lineHeight;
  return style;
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
