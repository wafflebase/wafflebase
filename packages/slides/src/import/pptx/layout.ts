import { BUILT_IN_LAYOUTS } from '../../model/layout';
import type { Layout } from '../../model/presentation';
import { ImportReport } from './report';
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
}

/**
 * Resolve a `ppt/slideLayouts/slideLayoutN.xml` document to one of our
 * eleven built-in layouts. v1 does *not* synthesise per-deck custom
 * layouts; the design doc reserves that for v1.5 alongside theme builder
 * editing of master/layout placeholders.
 */
export function parseLayout(
  xml: string,
  ooxmlPartName: string,
  report: ImportReport,
): ImportedLayout {
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

  return { ooxmlPartName, layout, placeholderSizes };
}

/**
 * Walk a layout's `<p:spTree>` for placeholder shapes and pull each
 * one's level-1 default font size out of `<a:lstStyle><a:lvl1pPr>
 * <a:defRPr sz>`. Returns a map keyed by `"{ooxmlType}:{idx}"` so the
 * slide parser can look up the right default for a given placeholder
 * reference.
 */
function parsePlaceholderSizes(sldLayout: Element): Map<string, number> {
  const out = new Map<string, number>();
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
    if (!txBody) continue;
    const lstStyle = child(txBody, 'lstStyle');
    if (!lstStyle) continue;
    const lvl1 = child(lstStyle, 'lvl1pPr');
    if (!lvl1) continue;
    const defRPr = child(lvl1, 'defRPr');
    if (!defRPr) continue;
    const sz = attrInt(defRPr, 'sz');
    if (sz == null) continue;
    out.set(`${type}:${idx}`, sz / 100);
  }
  return out;
}
