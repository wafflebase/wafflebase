import type { BlockStyle } from '@wafflebase/docs';
import type { Frame } from '../../model/element';
import { BUILT_IN_LAYOUTS } from '../../model/layout';
import type { Background, Layout } from '../../model/presentation';
import { isInheritableFill } from '../../model/presentation';
import type { ClrMap } from './color';
import { parseXfrm } from './geometry';
import type { ImageParseContext } from './image';
import { phKey } from './placeholder';
import { ImportReport } from './report';
import { parseSlideBackground } from './slide';
import { mapAlgn } from './text';
import { attr, attrInt, child, children, descendant, parseXml } from './xml';

/**
 * OOXML `<p:sldLayout type>` value → one of our built-in layout ids.
 *
 * PPTX defines ~30 layout `type` tokens; we collapse them onto the 11
 * Google-Slides-parity layouts shipped in v0.4.0. Any unrecognised
 * token falls back to `title-body` (the most common one in real decks)
 * and bumps `report.unknownLayoutTypes`.
 *
 * The benchmark Yorkie 캐즘 deck uses only `tx`, `secHead`, `body`, and
 * `title` — all covered explicitly below.
 */
const TYPE_TO_BUILT_IN: Record<string, string> = {
  title: 'title-slide',
  ctrTitle: 'title-slide',
  secHead: 'section-header',
  obj: 'title-body',
  tx: 'title-body',
  body: 'one-column-text',
  titleOnly: 'title-only',
  twoColTx: 'title-two-columns',
  twoObj: 'title-two-columns',
  twoTxTwoObj: 'title-two-columns',
  blank: 'blank',
};

export interface ImportedLayout {
  /** Stable id for this layout part — used by slide rels resolution. */
  ooxmlPartName: string;
  /** Built-in layout id that best matches the OOXML `type`. */
  layout: Layout;
  /**
   * Map of `"{ooxmlType}:{idx}"` → default `fontSize` in points, derived
   * from each layout placeholder's `<p:txBody><a:lstStyle><a:lvl1pPr>
   * <a:defRPr sz>`. Slide-level runs inherit this when their own
   * `<a:rPr>` lacks an explicit `sz`. The benchmark deck stores its
   * title-slide title size (`5200` → 52pt) only here — not on the
   * slide or in the master's `<p:txStyles>` — so we have to read
   * layout overrides to render titles faithfully.
   */
  placeholderSizes: Map<string, number>;
  /**
   * Map of `"{ooxmlType}:{idx}"` → default paragraph alignment, derived from
   * each layout placeholder's `<p:txBody><a:lstStyle><a:lvl1pPr algn>`. A
   * slide paragraph whose own `<a:pPr>` omits `algn` inherits this — PPTX
   * centers many titles only here (not on the slide or in the master's
   * `<p:txStyles>`). Only `lvl1` is read, matching {@link placeholderSizes}.
   */
  placeholderAlignments: Map<string, BlockStyle['alignment']>;
  /**
   * Frame (position + size, in px) per layout placeholder, keyed by
   * `"{ooxmlType}:{idx}"`. A slide placeholder whose own `<p:spPr>` omits
   * `<a:xfrm>` inherits this frame (PPTX slide → layout geometry); without
   * it the placeholder collapses to `(0,0,0,0)` at the top-left. Only
   * populated when the layout is parsed with a `bgCtx` (which carries the
   * EMU→px scale); empty otherwise.
   */
  placeholderFrames: Map<string, Frame>;
  /**
   * Layout-level `<p:bg>` when it carries a real background — an image
   * (`blipFill`) or an explicit `solidFill`. PPTX background inheritance is
   * slide → layout → master; a slide with no `<p:bg>` of its own inherits
   * this. Absent for layouts with no `<p:bg>`, a `<p:bgRef>` style-matrix
   * reference, or a bare role fill (those must not clobber the built-in
   * layout this collapses onto). Requires `bgCtx` to be resolved.
   */
  background?: Background;
}

/**
 * Image + color-map context needed to resolve a layout's `<p:bg>` blipFill
 * / solidFill. Optional on {@link parseLayout} so callers that only need the
 * layout id + placeholder sizes (and test harnesses) can skip it.
 */
export interface LayoutBackgroundContext {
  imageCtx: ImageParseContext;
  clrMap: ClrMap;
}

/**
 * Resolve a `ppt/slideLayouts/slideLayoutN.xml` document to one of our
 * eleven built-in layouts. v1 does *not* synthesise per-deck custom
 * layouts; the design doc reserves that for v1.5 alongside theme builder
 * editing of master/layout placeholders.
 */
export async function parseLayout(
  xml: string,
  ooxmlPartName: string,
  report: ImportReport,
  bgCtx?: LayoutBackgroundContext,
): Promise<ImportedLayout> {
  const doc = parseXml(xml);
  const sldLayout = descendant(doc, 'sldLayout');
  const rawType = sldLayout ? attr(sldLayout, 'type') : undefined;
  const builtInId = rawType ? TYPE_TO_BUILT_IN[rawType] : undefined;

  if (rawType && !builtInId) report.unknownLayoutTypes += 1;

  const targetId = builtInId ?? 'title-body';
  const layout = BUILT_IN_LAYOUTS.find((l) => l.id === targetId) ?? BUILT_IN_LAYOUTS[0];
  const placeholderSizes = sldLayout
    ? parsePlaceholderSizes(sldLayout)
    : new Map<string, number>();

  const placeholderAlignments = sldLayout
    ? parsePlaceholderAlignments(sldLayout)
    : new Map<string, BlockStyle['alignment']>();

  const placeholderFrames =
    sldLayout && bgCtx
      ? parsePlaceholderFrames(sldLayout, bgCtx.imageCtx.scale)
      : new Map<string, Frame>();

  const background = sldLayout ? await parseLayoutBackground(sldLayout, bgCtx) : undefined;

  return {
    ooxmlPartName,
    layout,
    placeholderSizes,
    placeholderAlignments,
    placeholderFrames,
    ...(background && { background }),
  };
}

/**
 * Walk a layout's `<p:spTree>` for placeholder shapes and pull each one's
 * `<p:spPr><a:xfrm>` frame (scaled to px), keyed by `"{ooxmlType}:{idx}"`.
 * Placeholders with no `<a:xfrm>` are skipped (nothing to inherit).
 */
function parsePlaceholderFrames(
  sldLayout: Element,
  scale: ImageParseContext['scale'],
): Map<string, Frame> {
  const out = new Map<string, Frame>();
  const cSld = child(sldLayout, 'cSld');
  const spTree = cSld ? child(cSld, 'spTree') : undefined;
  if (!spTree) return out;
  for (const sp of children(spTree, 'sp')) {
    const nvSpPr = child(sp, 'nvSpPr');
    const nvPr = nvSpPr ? child(nvSpPr, 'nvPr') : undefined;
    const ph = nvPr ? child(nvPr, 'ph') : undefined;
    if (!ph) continue;
    const type = attr(ph, 'type') ?? 'body';
    const idx = attr(ph, 'idx') ?? '0';

    const spPr = child(sp, 'spPr');
    const xfrm = spPr ? child(spPr, 'xfrm') : undefined;
    if (!xfrm) continue;
    out.set(phKey(type, idx), parseXfrm(xfrm, scale));
  }
  return out;
}

/**
 * Resolve a layout's `<p:cSld><p:bg>` into a {@link Background}, but only
 * keep it when it carries an image or an explicit `solidFill`. A bare role
 * fill / unhandled `<p:bgRef>` returns `undefined` so the caller leaves the
 * built-in layout's (absent) background untouched instead of overriding it
 * with a no-op fill.
 */
async function parseLayoutBackground(
  sldLayout: Element,
  bgCtx?: LayoutBackgroundContext,
): Promise<Background | undefined> {
  if (!bgCtx) return undefined;
  const cSld = child(sldLayout, 'cSld');
  const bgEl = cSld ? child(cSld, 'bg') : undefined;
  if (!bgEl) return undefined;

  const parsed = await parseSlideBackground(bgEl, bgCtx.clrMap, bgCtx.imageCtx);
  // Keep only a *real* background: a resolved image, or an explicit
  // (non-inheritable) fill override. A bare role fill — which is what
  // `parseSlideBackground` returns for an unhandled `<p:bgRef>`, a
  // `solidFill` whose scheme color didn't resolve, or a failed blip upload
  // — is dropped so the slide keeps inheriting instead of baking the deck
  // default and masking the theme / master background.
  const hasRealFill = parsed.fill !== undefined && !isInheritableFill(parsed.fill);
  return parsed.image || hasRealFill ? parsed : undefined;
}

/**
 * Walk a layout's `<p:spTree>` for placeholder shapes that carry a
 * `<p:txBody><a:lstStyle><a:lvl1pPr>`, yielding each one's inheritance key
 * (`"{ooxmlType}:{idx}"`) paired with that level-1 paragraph-properties
 * element. Shared by the size and alignment parsers so the traversal and
 * placeholder-discovery rules live in one place.
 */
function eachPlaceholderLvl1(sldLayout: Element): Array<[string, Element]> {
  const out: Array<[string, Element]> = [];
  const cSld = child(sldLayout, 'cSld');
  const spTree = cSld ? child(cSld, 'spTree') : undefined;
  if (!spTree) return out;
  for (const sp of children(spTree, 'sp')) {
    const nvSpPr = child(sp, 'nvSpPr');
    const nvPr = nvSpPr ? child(nvSpPr, 'nvPr') : undefined;
    const ph = nvPr ? child(nvPr, 'ph') : undefined;
    if (!ph) continue;
    const type = attr(ph, 'type') ?? 'body';
    const idx = attr(ph, 'idx') ?? '0';

    const txBody = child(sp, 'txBody');
    const lstStyle = txBody ? child(txBody, 'lstStyle') : undefined;
    const lvl1 = lstStyle ? child(lstStyle, 'lvl1pPr') : undefined;
    if (!lvl1) continue;
    out.push([phKey(type, idx), lvl1]);
  }
  return out;
}

/**
 * Pull each placeholder's level-1 default font size out of
 * `<a:lstStyle><a:lvl1pPr><a:defRPr sz>`. Keyed by `"{ooxmlType}:{idx}"`
 * so the slide parser can look up the right default for a given placeholder.
 */
function parsePlaceholderSizes(sldLayout: Element): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, lvl1] of eachPlaceholderLvl1(sldLayout)) {
    const defRPr = child(lvl1, 'defRPr');
    const sz = defRPr ? attrInt(defRPr, 'sz') : null;
    if (sz == null) continue;
    out.set(key, sz / 100);
  }
  return out;
}

/**
 * Pull each placeholder's level-1 default paragraph alignment out of
 * `<a:lstStyle><a:lvl1pPr algn>`. Keyed by `"{ooxmlType}:{idx}"`.
 * Placeholders whose `lvl1pPr` carries no `algn` contribute nothing (the
 * entry stays absent, so master `<p:txStyles>` can still supply a deeper
 * fallback). Only `lvl1` is read, so callers apply it to level-0 paragraphs.
 */
function parsePlaceholderAlignments(sldLayout: Element): Map<string, BlockStyle['alignment']> {
  const out = new Map<string, BlockStyle['alignment']>();
  for (const [key, lvl1] of eachPlaceholderLvl1(sldLayout)) {
    const alignment = mapAlgn(attr(lvl1, 'algn'));
    if (!alignment) continue;
    out.set(key, alignment);
  }
  return out;
}
