import type { BlockMarker, BlockStyle } from '@wafflebase/docs';
import type { Master, MasterBackground } from '../../model/master';
import { DEFAULT_MASTER } from '../../model/master';
import { clone } from '../../model/clone';
import { parseColorFromContainer, type ClrMap } from './color';
import { parseBlipFill, toBackgroundImage, type ImageParseContext } from './image';
import { mapAlgn } from './text';
import { attr, attrInt, child, descendant, parseXml } from './xml';

/**
 * OOXML `<p:clrMap>` attributes — translation table from logical
 * scheme tokens (`bg1` / `bg2` / `tx1` / `tx2` / `accent1..6` /
 * `hlink` / `folHlink`) to actual scheme slot names. Real-world decks
 * (including the Yorkie 캐즘 benchmark) emit non-identity mappings
 * — e.g. `bg2="dk2"` swaps `bg2` away from its default `lt2` slot.
 */
const CLR_MAP_KEYS = [
  'bg1', 'tx1', 'bg2', 'tx2',
  'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6',
  'hlink', 'folHlink',
] as const;

/**
 * Parse `ppt/slideMasters/slideMaster1.xml` into a `Master`.
 *
 * v1 scope: read just the master-level background and inherit the rest
 * of the placeholder-style table from `DEFAULT_MASTER`. Per-placeholder
 * style overrides on the master are reachable via `<p:txStyles>` and
 * will land alongside Task 3 text parsing — the first consumer is the
 * docs-style block emitter, not the master importer itself.
 */
/**
 * Default `BlockMarker` per OOXML txStyles slot (`title` / `body` / `other`)
 * and outline level (0–8 ⇆ `<a:lvl1pPr>`–`<a:lvl9pPr>`). Slides paragraphs
 * inherit these axes when their own `<a:pPr>` doesn't carry a matching
 * `<a:buFont>`, `<a:buSzPts>`, or `<a:buClr>`. PowerPoint authors the
 * bullet typeface (e.g. `Arial`) exclusively here for many decks — the
 * paragraph only inlines per-slide overrides like `buSzPts` / `buClr`.
 */
export type TxStylesSlot = 'title' | 'body' | 'other';
export type TxStylesMarkers = Map<TxStylesSlot, Map<number, BlockMarker>>;
/**
 * Default paragraph alignment per `<p:txStyles>` slot, read from each slot's
 * `<a:lvl1pPr algn>`. The deeper fallback under the layout placeholder
 * `<a:lstStyle>` in the alignment inheritance chain; `lvl1` only, matching
 * how the layout parser exposes a single default per placeholder.
 */
export type TxStylesAlignments = Map<TxStylesSlot, BlockStyle['alignment']>;

export interface ImportedMaster {
  master: Master;
  /** Translation table from the master's `<p:clrMap>` for slide-level color resolution. */
  clrMap: ClrMap;
  /**
   * Default bullet marker per `<p:txStyles>` slot × outline level.
   * Empty when the master omits `<p:txStyles>` (rare). Consumers index
   * with the resolved txStyles slot for a placeholder type and the
   * paragraph's level, then merge into the paragraph's own `BlockMarker`
   * for any axis the paragraph didn't override.
   */
  txStylesMarkers: TxStylesMarkers;
  /**
   * Default paragraph alignment per `<p:txStyles>` slot. Consumed when the
   * slide's layout placeholder `<a:lstStyle>` doesn't set a default. Empty
   * when the master omits `<p:txStyles>` or no slot sets `algn`.
   */
  txStylesAlignments: TxStylesAlignments;
}

export async function parseMaster(
  xml: string,
  id: string,
  themeId: string,
  imageCtx: ImageParseContext,
): Promise<ImportedMaster> {
  const doc = parseXml(xml);
  const sldMaster = descendant(doc, 'sldMaster');
  const cSld = sldMaster ? child(sldMaster, 'cSld') : undefined;
  const bg = cSld ? child(cSld, 'bg') : undefined;
  const clrMap = sldMaster ? parseClrMap(sldMaster) : new Map<string, string>();
  const txStylesMarkers = sldMaster
    ? parseTxStylesMarkers(sldMaster, clrMap)
    : (new Map() as TxStylesMarkers);
  const txStylesAlignments = sldMaster
    ? parseTxStylesAlignments(sldMaster)
    : (new Map() as TxStylesAlignments);

  // Master `<p:bg>` is parsed without `clrMap` — backgrounds almost
  // always use direct scheme slot names (`lt1` / `dk1`) rather than the
  // logical `bg1` / `tx1` aliases that `<p:clrMap>` rewires.
  const background = bg
    ? await parseBackground(bg, imageCtx)
    : clone(DEFAULT_MASTER.background);

  // `clone()` deep-copies so the imported master can mutate its
  // background / placeholderStyles without leaking back into
  // `DEFAULT_MASTER` (which is read-only by intent — many decks share
  // it via module identity).
  return {
    master: {
      id,
      themeId,
      background,
      placeholderStyles: clone(DEFAULT_MASTER.placeholderStyles),
    },
    clrMap,
    txStylesMarkers,
    txStylesAlignments,
  };
}

/**
 * Parse `<p:txStyles>` into a slot × level → `BlockMarker` map.
 *
 * OOXML structure:
 *   <p:txStyles>
 *     <p:titleStyle> <a:lvl1pPr>…</a:lvl1pPr> … </p:titleStyle>
 *     <p:bodyStyle>  <a:lvl1pPr>…</a:lvl1pPr> … </p:bodyStyle>
 *     <p:otherStyle> <a:lvl1pPr>…</a:lvl1pPr> … </p:otherStyle>
 *   </p:txStyles>
 *
 * Per level we record only the three marker-relevant children
 * (`<a:buFont typeface=…>`, `<a:buSzPts val=…>`, `<a:buClr>…</a:buClr>`)
 * so the slide parser can fill in axes the per-paragraph `<a:pPr>` left
 * blank. We deliberately *don't* infer marker style from `<a:defRPr>` —
 * the OOXML spec treats run defaults and bullet defaults as independent,
 * and conflating them in the importer would mis-render decks whose
 * marker style legitimately diverges from the run style.
 *
 * `<a:buNone/>` at the level marks "no list" and is left to the
 * paragraph's own bullet decision to honour; we simply don't emit a
 * marker for that level so the merge step is a no-op.
 */
function parseTxStylesMarkers(
  sldMaster: Element,
  clrMap: ClrMap,
): TxStylesMarkers {
  const out: TxStylesMarkers = new Map();
  const txStyles = child(sldMaster, 'txStyles');
  if (!txStyles) return out;

  const slotMap: Array<[string, TxStylesSlot]> = [
    ['titleStyle', 'title'],
    ['bodyStyle', 'body'],
    ['otherStyle', 'other'],
  ];

  for (const [tagName, slot] of slotMap) {
    const styleEl = child(txStyles, tagName);
    if (!styleEl) continue;
    const levelMap = new Map<number, BlockMarker>();
    for (let i = 0; i < styleEl.childNodes.length; i++) {
      const n = styleEl.childNodes[i];
      if (n.nodeType !== 1) continue;
      const lvlEl = n as Element;
      const m = /^lvl([1-9])pPr$/.exec(lvlEl.localName);
      if (!m) continue;
      const level = Number(m[1]) - 1; // lvl1pPr → 0
      const marker = extractMarkerFromLevelPPr(lvlEl, clrMap);
      if (marker) levelMap.set(level, marker);
    }
    if (levelMap.size > 0) out.set(slot, levelMap);
  }

  return out;
}

/**
 * Parse `<p:txStyles>` into a slot → default alignment map, reading each
 * slot's `<a:lvl1pPr algn>`. Sparse: a slot with no `algn` on its level-1
 * paragraph properties is omitted so the layout placeholder default (or the
 * docs left default) still applies.
 */
function parseTxStylesAlignments(sldMaster: Element): TxStylesAlignments {
  const out: TxStylesAlignments = new Map();
  const txStyles = child(sldMaster, 'txStyles');
  if (!txStyles) return out;

  const slotMap: Array<[string, TxStylesSlot]> = [
    ['titleStyle', 'title'],
    ['bodyStyle', 'body'],
    ['otherStyle', 'other'],
  ];

  for (const [tagName, slot] of slotMap) {
    const styleEl = child(txStyles, tagName);
    if (!styleEl) continue;
    const lvl1 = child(styleEl, 'lvl1pPr');
    if (!lvl1) continue;
    const alignment = mapAlgn(attr(lvl1, 'algn'));
    if (alignment) out.set(slot, alignment);
  }

  return out;
}

function extractMarkerFromLevelPPr(
  lvlPPr: Element,
  clrMap: ClrMap,
): BlockMarker | undefined {
  let marker: BlockMarker | undefined;

  const buFont = child(lvlPPr, 'buFont');
  if (buFont) {
    const typeface = attr(buFont, 'typeface');
    if (typeface) marker = { ...(marker ?? {}), fontFamily: typeface };
  }

  const buSzPts = child(lvlPPr, 'buSzPts');
  if (buSzPts) {
    const v = attrInt(buSzPts, 'val');
    if (v != null && v > 0) marker = { ...(marker ?? {}), fontSize: v / 100 };
  }

  const buClr = child(lvlPPr, 'buClr');
  if (buClr) {
    const color = parseColorFromContainer(buClr, clrMap);
    if (color) marker = { ...(marker ?? {}), color };
  }

  return marker;
}

/**
 * Default OOXML clrMap (the implicit mapping when `<p:clrMap>` is
 * omitted). Identity for accent / hlink slots; aliases bg1/tx1/bg2/tx2
 * to their default scheme slot names.
 */
const DEFAULT_CLR_MAP: Record<string, string> = {
  bg1: 'lt1',
  tx1: 'dk1',
  bg2: 'lt2',
  tx2: 'dk2',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  hlink: 'hlink',
  folHlink: 'folHlink',
};

function parseClrMap(sldMaster: Element): ClrMap {
  const map = new Map<string, string>();
  const el = child(sldMaster, 'clrMap');
  if (!el) return map;
  for (const key of CLR_MAP_KEYS) {
    const value = attr(el, key);
    // Skip identity (matches OOXML default) — keeps the map sparse and
    // makes test assertions clearer. Non-identity entries are what
    // matter at color-resolution time.
    if (value && value !== DEFAULT_CLR_MAP[key]) map.set(key, value);
  }
  return map;
}

async function parseBackground(
  bg: Element,
  imageCtx: ImageParseContext,
): Promise<MasterBackground> {
  // `<p:bg>` wraps either `<p:bgPr>` (literal fill) or `<p:bgRef>` (style
  // matrix index). v2 adds blipFill alongside solidFill; bgRef is still
  // unhandled and falls through to the default.
  const bgPr = child(bg, 'bgPr');
  if (bgPr) {
    const blipFill = child(bgPr, 'blipFill');
    if (blipFill) {
      const blip = await parseBlipFill(blipFill, imageCtx);
      if (blip) {
        return { fill: clone(DEFAULT_MASTER.background).fill, image: toBackgroundImage(blip) };
      }
    }
    const solid = child(bgPr, 'solidFill');
    if (solid) {
      const color = parseColorFromContainer(solid);
      if (color) return { fill: color };
    }
  }
  return clone(DEFAULT_MASTER.background);
}
